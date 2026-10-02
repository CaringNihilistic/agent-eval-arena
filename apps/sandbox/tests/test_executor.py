"""Escape attempts and resource abuse against the executor.

These tests are meant to run inside the sandbox container (`pnpm test:api`), where
the container-level restrictions are also in force: no network, read-only root
filesystem, no capabilities, a non-root user.
"""

import asyncio
import os
import textwrap
from pathlib import Path

from fastapi.testclient import TestClient

from sandbox.executor import (
    WORK_ROOT,
    ExecLimits,
    ExecResult,
    execute,
    parse_mermaid,
    stray_processes,
)
from sandbox.main import FIXTURES_DIR, MAX_CODE_CHARS, app


async def run(code: str, timeout_s: float = 8.0) -> ExecResult:
    return await execute(textwrap.dedent(code), ExecLimits(timeout_s=timeout_s), FIXTURES_DIR)


def leftover_workdirs() -> list[Path]:
    return list(WORK_ROOT.glob("exec-*"))


def dead_but_unreaped() -> int:
    """Zombie processes. The container's init should reap them almost at once."""
    count = 0
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            try:
                state = (entry / "stat").read_text().rsplit(")", 1)[1].split()[0]
            except OSError:
                continue
            count += state == "Z"
    return count


async def test_runs_code_and_returns_stdout() -> None:
    result = await run("print(6 * 7)")

    assert result.stdout == "42\n"
    assert result.exit_code == 0
    assert not result.timed_out
    assert not result.truncated


async def test_reports_an_exception_with_a_nonzero_exit() -> None:
    result = await run("raise ValueError('boom')")

    assert result.exit_code == 1
    assert "ValueError: boom" in result.stderr


async def test_data_libraries_work_within_the_limits() -> None:
    result = await run(
        """
        import pandas as pd
        print(int(pd.DataFrame({"a": [1, 2, 3]})["a"].sum()))
        """
    )

    assert result.stdout == "6\n", result.stderr


async def test_can_read_a_fixture() -> None:
    result = await run(
        """
        import os
        with open(os.path.join(os.environ["FIXTURES_DIR"], "dev_sales.csv")) as f:
            print(f.readline().strip())
        """
    )

    assert result.stdout == "region,month,units,unit_price\n", result.stderr


async def test_busy_loop_is_killed_at_the_timeout() -> None:
    result = await run("while True:\n    pass", timeout_s=1.0)

    assert result.timed_out
    assert result.exit_code is None
    assert result.duration_ms < 4000


async def test_sleeping_process_is_killed_at_the_timeout() -> None:
    result = await run("import time\ntime.sleep(60)", timeout_s=1.0)

    assert result.timed_out
    assert result.duration_ms < 4000


async def test_memory_bomb_fails_without_taking_the_service_down() -> None:
    result = await run("data = bytearray(2 * 1024**3)\nprint('allocated')")

    assert "allocated" not in result.stdout
    assert "MemoryError" in result.stderr
    assert (await run("print('still alive')")).stdout == "still alive\n"


async def test_fork_bomb_is_contained() -> None:
    result = await run(
        """
        import os, time
        spawned = 0
        try:
            for _ in range(1000):
                if os.fork() == 0:
                    time.sleep(30)
                    os._exit(0)
                spawned += 1
        except OSError as error:
            print("fork refused after", spawned, type(error).__name__)
        """,
        timeout_s=5.0,
    )

    assert "fork refused after" in result.stdout, result.stderr
    assert stray_processes() == []
    await asyncio.sleep(0.5)
    assert dead_but_unreaped() == 0
    assert (await run("print('still alive')")).stdout == "still alive\n"


async def test_process_that_detaches_into_its_own_session_is_reaped() -> None:
    result = await run(
        """
        import os, time
        if os.fork() == 0:
            os.setsid()
            if os.fork() == 0:
                time.sleep(60)
            os._exit(0)
        print("parent done")
        """
    )

    assert "parent done" in result.stdout
    assert result.duration_ms < 4000
    assert stray_processes() == []


async def test_network_is_unreachable() -> None:
    result = await run(
        """
        import socket
        for label, attempt in [
            ("ip", lambda: socket.create_connection(("1.1.1.1", 443), timeout=3)),
            ("dns", lambda: socket.getaddrinfo("example.com", 443)),
        ]:
            try:
                attempt()
                print(label, "REACHED")
            except OSError:
                print(label, "blocked")
        """
    )

    assert result.stdout == "ip blocked\ndns blocked\n", result.stderr


async def test_cannot_write_outside_its_working_directory() -> None:
    result = await run(
        """
        import os
        targets = ["/opt/x", "/etc/x", "/repo/apps/sandbox/x",
                   os.path.join(os.environ["FIXTURES_DIR"], "x")]
        for path in targets:
            try:
                open(path, "w").close()
                print("WROTE", path)
            except OSError:
                print("denied")
        """
    )

    assert result.stdout == "denied\n" * 4, result.stdout


async def test_oversized_file_is_refused() -> None:
    result = await run(
        """
        with open("big.bin", "wb") as f:
            f.write(b"x" * (20 * 1024 * 1024))
        print("written")
        """
    )

    assert "written" not in result.stdout
    assert result.exit_code != 0


async def test_output_flood_is_truncated() -> None:
    result = await run("print('x' * 5_000_000)")

    assert result.truncated
    assert len(result.stdout) <= ExecLimits().max_output_bytes


async def test_environment_holds_no_secrets() -> None:
    os.environ["ARENA_FAKE_API_KEY"] = "should-not-leak"
    try:
        result = await run("import os\nprint(sorted(os.environ))")
    finally:
        del os.environ["ARENA_FAKE_API_KEY"]

    assert "ARENA_FAKE_API_KEY" not in result.stdout
    assert "should-not-leak" not in result.stdout
    for marker in ("KEY", "TOKEN", "SECRET", "PASSWORD"):
        assert marker not in result.stdout.upper()


async def test_runs_as_an_unprivileged_user() -> None:
    result = await run(
        """
        import os
        caps = [l for l in open("/proc/self/status") if l.startswith("CapEff")][0].split()[1]
        print(os.getuid() != 0, int(caps, 16) == 0)
        """
    )

    assert result.stdout == "True True\n"


async def test_working_directory_is_removed_afterwards() -> None:
    await run("open('scratch.txt', 'w').write('data')")
    await run("while True:\n    pass", timeout_s=1.0)

    assert leftover_workdirs() == []


def test_exec_endpoint_returns_the_result() -> None:
    response = TestClient(app).post("/exec", json={"code": "print('hi')"})

    assert response.status_code == 200
    body = response.json()
    assert body["stdout"] == "hi\n"
    assert body["exit_code"] == 0
    assert body["timed_out"] is False


def test_exec_endpoint_rejects_oversized_code_and_long_timeouts() -> None:
    client = TestClient(app)

    assert client.post("/exec", json={"code": "x" * (MAX_CODE_CHARS + 1)}).status_code == 422
    assert client.post("/exec", json={"code": "print(1)", "timeout_s": 60}).status_code == 422
    assert client.post("/exec", json={"code": ""}).status_code == 422


FLOWCHART = (
    "flowchart TD\n"
    "  A[Order placed] --> B{In stock?}\n"
    "  B -- Yes --> C[Ship]\n"
    "  B -- No --> D[Refund]"
)
SEQUENCE = "sequenceDiagram\n  participant U as User\n  U->>A: Log in\n  A-->>U: Token"
STATE = "stateDiagram-v2\n  [*] --> Open\n  Open --> Closed\n  Closed --> [*]"


async def test_mermaid_parser_accepts_valid_diagrams() -> None:
    for diagram in (FLOWCHART, SEQUENCE, STATE):
        verdict = await parse_mermaid(diagram)
        assert verdict.valid, (diagram, verdict.error)
        assert verdict.error is None


async def test_mermaid_parser_rejects_text_that_is_not_a_diagram() -> None:
    broken = await parse_mermaid("flowchart TD\n  A[Unclosed --> B")
    prose = await parse_mermaid("Here is your diagram: boxes and arrows.")

    assert not broken.valid
    assert broken.error
    assert not prose.valid
    assert prose.error
    assert stray_processes() == []


def test_mermaid_endpoint() -> None:
    client = TestClient(app)

    good = client.post("/mermaid/parse", json={"code": FLOWCHART})
    bad = client.post("/mermaid/parse", json={"code": "not a diagram"})

    assert good.json() == {"valid": True, "error": None}
    assert bad.json()["valid"] is False
    assert client.post("/mermaid/parse", json={"code": ""}).status_code == 422
