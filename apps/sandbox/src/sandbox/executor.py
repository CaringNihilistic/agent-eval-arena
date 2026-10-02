"""Run untrusted Python in a child process with hard resource limits.

This is one layer of the sandbox. The container adds the rest: no network, a
read-only root filesystem, no capabilities, a non-root user, and memory, CPU,
and process-count limits (see docker-compose.yml).
"""

import asyncio
import contextlib
import json
import os
import resource
import shutil
import signal
import sys
import tempfile
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

WORK_ROOT = Path("/tmp")  # The container mounts a tmpfs here.
READ_CHUNK = 65536
DRAIN_GRACE_S = 1.0
EXIT_POLL_S = 0.02


@dataclass(frozen=True)
class ExecLimits:
    timeout_s: float = 5.0
    address_space_bytes: int = 768 * 1024 * 1024
    max_processes: int = 64
    max_file_bytes: int = 5 * 1024 * 1024
    max_open_files: int = 64
    max_output_bytes: int = 20_000


@dataclass(frozen=True)
class ExecResult:
    stdout: str
    stderr: str
    exit_code: int | None
    timed_out: bool
    truncated: bool
    duration_ms: int


# One execution at a time: stray-process cleanup assumes nothing else is running.
_exec_lock = asyncio.Lock()


def _apply_limits(limits: ExecLimits) -> None:
    """Runs in the child between fork and exec."""
    cpu_seconds = int(limits.timeout_s) + 1
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    resource.setrlimit(resource.RLIMIT_AS, (limits.address_space_bytes, limits.address_space_bytes))
    resource.setrlimit(resource.RLIMIT_NPROC, (limits.max_processes, limits.max_processes))
    resource.setrlimit(resource.RLIMIT_FSIZE, (limits.max_file_bytes, limits.max_file_bytes))
    resource.setrlimit(resource.RLIMIT_NOFILE, (limits.max_open_files, limits.max_open_files))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _child_env(workdir: Path, fixtures_dir: Path) -> dict[str, str]:
    """A minimal environment. Nothing from the service's own environment leaks in."""
    return {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": str(workdir),
        "TMPDIR": str(workdir),
        "FIXTURES_DIR": str(fixtures_dir),
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
    }


class _Capture:
    """Keeps the first `cap` bytes of a stream and discards the rest, so output
    cannot exhaust memory. What was read survives even if the reader is cancelled."""

    def __init__(self, cap: int) -> None:
        self._cap = cap
        self.data = bytearray()
        self.truncated = False

    async def read(self, stream: asyncio.StreamReader) -> None:
        while chunk := await stream.read(READ_CHUNK):
            room = self._cap - len(self.data)
            if room > 0:
                self.data += chunk[:room]
            if len(chunk) > room:
                self.truncated = True

    def text(self) -> str:
        return self.data.decode("utf-8", errors="replace")


def _kill_group(pid: int) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pid, signal.SIGKILL)


def _ancestors() -> set[int]:
    pids = {os.getpid()}
    pid = os.getpid()
    while pid > 1:
        try:
            stat = Path(f"/proc/{pid}/stat").read_text()
        except OSError:
            break
        # The parent pid is the second field after the parenthesised command name.
        pid = int(stat.rsplit(")", 1)[1].split()[1])
        pids.add(pid)
    return pids


def _is_live(entry: Path) -> bool:
    """False for a zombie: already dead, waiting for the container's init to reap it."""
    state = (entry / "stat").read_text().rsplit(")", 1)[1].split()[0]
    return state != "Z"


def _parents() -> dict[int, int]:
    """Every process the container can see, mapped to its parent's pid."""
    parents = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
        except OSError:
            continue
        parents[int(entry.name)] = int(stat.rsplit(")", 1)[1].split()[1])
    return parents


def is_injected(pid: int, parents: Mapping[int, int]) -> bool:
    """True for a process put into the container from outside, or descended from one.

    Docker's health check and `docker exec` start a process whose parent is outside
    the container, which shows here as parent pid 0. Only the container's init
    (pid 1) and such processes have that. Code the sandbox runs cannot: its
    processes descend from this service, and an orphan is adopted by init. So a
    chain of parents that ends at a pid other than 1 was not left by executed code.
    """
    seen: set[int] = set()
    while pid in parents and pid not in seen:
        seen.add(pid)
        parent = parents[pid]
        if parent == 0:
            return pid != 1
        pid = parent
    # The chain broke because a process exited mid-scan. Unknown is treated as a stray.
    return False


def stray_processes() -> list[int]:
    """Live processes owned by this user that executed code could have left behind:
    not this service, not an ancestor of it, and not started from outside the
    container (the Docker health check runs here every few seconds)."""
    keep = _ancestors()
    uid = os.getuid()
    parents = _parents()
    strays = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) in keep:
            continue
        try:
            owned_and_live = entry.stat().st_uid == uid and _is_live(entry)
        except OSError:
            continue
        if owned_and_live and not is_injected(int(entry.name), parents):
            strays.append(int(entry.name))
    return strays


def _reap_strays() -> None:
    """Kill anything the executed code left behind, including processes that
    detached into their own session to escape the process-group kill."""
    for pid in stray_processes():
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.kill(pid, signal.SIGKILL)


async def _exited(process: asyncio.subprocess.Process, timeout_s: float) -> bool:
    """Wait for the child itself to exit.

    `process.wait()` is not used: it also waits for the output pipes to close, and
    a detached grandchild can hold them open long after the child is gone.
    """
    deadline = time.monotonic() + timeout_s
    while process.returncode is None:
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(EXIT_POLL_S)
    return True


async def _drain(readers: list[asyncio.Task[None]]) -> None:
    """Let the readers finish. Once every process that held the pipes is dead this
    is immediate; the grace period only bounds the unexpected case."""
    _done, pending = await asyncio.wait(readers, timeout=DRAIN_GRACE_S)
    for task in pending:
        task.cancel()


async def execute(code: str, limits: ExecLimits, fixtures_dir: Path) -> ExecResult:
    async with _exec_lock:
        workdir = Path(tempfile.mkdtemp(prefix="exec-", dir=WORK_ROOT))
        try:
            return await _run(code, limits, workdir, fixtures_dir)
        finally:
            _reap_strays()
            shutil.rmtree(workdir, ignore_errors=True)


async def _run(code: str, limits: ExecLimits, workdir: Path, fixtures_dir: Path) -> ExecResult:
    (workdir / "main.py").write_text(code, encoding="utf-8")
    started = time.monotonic()
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        "main.py",
        cwd=workdir,
        env=_child_env(workdir, fixtures_dir),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
        preexec_fn=lambda: _apply_limits(limits),
    )
    assert process.stdout is not None and process.stderr is not None
    half = limits.max_output_bytes // 2
    stdout, stderr = _Capture(half), _Capture(half)
    readers = [
        asyncio.create_task(stdout.read(process.stdout)),
        asyncio.create_task(stderr.read(process.stderr)),
    ]

    timed_out = not await _exited(process, limits.timeout_s)
    # Kill the child's process group, then anything that detached from it. With
    # every holder of the pipes dead, the readers reach end of file.
    _kill_group(process.pid)
    _reap_strays()
    await _exited(process, DRAIN_GRACE_S)
    await _drain(readers)

    return ExecResult(
        stdout=stdout.text(),
        stderr=stderr.text(),
        exit_code=None if timed_out else process.returncode,
        timed_out=timed_out,
        truncated=stdout.truncated or stderr.truncated,
        duration_ms=int((time.monotonic() - started) * 1000),
    )


MERMAID_DIR = Path("/opt/mermaid")
MERMAID_TIMEOUT_S = 20.0


@dataclass(frozen=True)
class MermaidVerdict:
    valid: bool
    error: str | None


class MermaidUnavailableError(Exception):
    """The parser did not give a verdict: it timed out or crashed. This says
    nothing about the diagram, so it must never be reported as "invalid"."""


async def parse_mermaid(code: str) -> MermaidVerdict:
    """Run the real Mermaid parser on diagram text.

    The text is data for the parser, not a program, so the memory limit used for
    executed code is not applied here: Node needs a large address space to start.
    The timeout, the minimal environment, and the container's own limits still hold.
    """
    async with _exec_lock:
        started = await asyncio.create_subprocess_exec(
            "node",
            "check.mjs",
            cwd=MERMAID_DIR,
            env={"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"), "HOME": "/tmp"},
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        try:
            stdout, _stderr = await asyncio.wait_for(
                started.communicate(code.encode("utf-8")), timeout=MERMAID_TIMEOUT_S
            )
        except TimeoutError as error:
            _kill_group(started.pid)
            await started.wait()
            raise MermaidUnavailableError("The parser did not finish in time.") from error
        finally:
            _reap_strays()
    try:
        verdict = json.loads(stdout.decode("utf-8"))
        return MermaidVerdict(bool(verdict["valid"]), verdict.get("error"))
    except (json.JSONDecodeError, KeyError, UnicodeDecodeError) as error:
        raise MermaidUnavailableError("The parser gave no verdict.") from error
