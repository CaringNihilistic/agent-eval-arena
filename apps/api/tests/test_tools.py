"""calculator, read_file, search_docs, and the python_exec client."""

import os
from pathlib import Path

import httpx
import pytest

from arena.settings import get_settings
from arena.tools.calculator import Calculator, CalculatorError, evaluate
from arena.tools.python_exec import PythonExec
from arena.tools.read_file import MAX_FILE_BYTES, ReadFile
from arena.tools.search_docs import SearchDocs

# ---------------------------------------------------------------- calculator


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("2 + 3 * 4", 14),
        ("(37 * 4.85 + 12 * 13.40) * 0.92", 313.03),
        ("2 ** 10", 1024),
        ("-7 // 2", -4),
        ("17 % 5", 2),
        ("sqrt(144)", 12),
        ("round(3.14159, 2)", 3.14),
        ("max(3, 9, 4) - min(3, 9, 4)", 6),
        ("floor(2.7) + ceil(2.1)", 5),
        ("log10(1000)", 3),
        ("round(pi, 4)", 3.1416),
    ],
)
def test_calculator_evaluates_arithmetic(expression: str, expected: float) -> None:
    assert evaluate(expression) == pytest.approx(expected)


@pytest.mark.parametrize(
    "expression",
    [
        "__import__('os').system('id')",
        "open('/etc/passwd').read()",
        "().__class__.__bases__",
        "(1).__class__",
        "[x for x in range(3)]",
        "lambda: 1",
        "'a' * 3",
        "x + 1",
        "exec('1')",
        "1 if 2 else 3",
        "9 ** 9 ** 9",
        "2 ** 100000",
        "1 / 0",
        "sqrt(-1)",
        "(-8) ** 0.5",
        "abs(x=1)",
        "1 +",
        "1; 2",
        "True + 1",
    ],
)
def test_calculator_refuses_anything_that_is_not_arithmetic(expression: str) -> None:
    with pytest.raises(CalculatorError):
        evaluate(expression)


def test_calculator_refuses_oversized_expressions() -> None:
    with pytest.raises(CalculatorError, match="longer than"):
        evaluate("1+" * 300 + "1")


async def test_calculator_tool_formats_results_and_reports_errors() -> None:
    tool = Calculator()

    assert (await tool.run({"expression": "10 / 4"})).output == "2.5"
    assert (await tool.run({"expression": "10 / 5"})).output == "2"
    assert (await tool.run({"expression": "2 ** 62"})).output == "4611686018427387904"
    failed = await tool.run({"expression": "import os"})
    assert not failed.success and failed.error
    assert not (await tool.run({})).success
    assert not (await tool.run({"expression": 42})).success


# ----------------------------------------------------------------- read_file


@pytest.fixture
def fixtures(tmp_path: Path) -> Path:
    root = tmp_path / "fixtures"
    (root / "nested").mkdir(parents=True)
    (root / "data.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    (root / "nested" / "notes.txt").write_text("hello", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("top secret", encoding="utf-8")
    return root


async def test_read_file_reads_and_lists(fixtures: Path) -> None:
    tool = ReadFile(fixtures)

    assert (await tool.run({"path": "data.csv"})).output == "a,b\n1,2\n"
    assert (await tool.run({"path": "nested/notes.txt"})).output == "hello"
    assert (await tool.run({"path": "."})).output == "data.csv\nnested/notes.txt"


@pytest.mark.parametrize(
    "path",
    [
        "../secret.txt",
        "nested/../../secret.txt",
        "/etc/passwd",
        "..",
        "nested/../../../../../../etc/hostname",
    ],
)
async def test_read_file_refuses_paths_outside_the_fixtures_folder(
    fixtures: Path, path: str
) -> None:
    result = await ReadFile(fixtures).run({"path": path})

    assert not result.success
    assert result.error == "path is outside the fixtures folder"
    assert "secret" not in result.output


async def test_read_file_refuses_a_symlink_that_points_outside(fixtures: Path) -> None:
    link = fixtures / "link.txt"
    try:
        link.symlink_to(fixtures.parent / "secret.txt")
    except OSError:
        pytest.skip("symlinks are not available on this filesystem")

    result = await ReadFile(fixtures).run({"path": "link.txt"})

    assert not result.success
    assert "top secret" not in result.output


async def test_read_file_reports_missing_large_and_binary_files(fixtures: Path) -> None:
    (fixtures / "big.txt").write_bytes(b"x" * (MAX_FILE_BYTES + 1))
    (fixtures / "image.bin").write_bytes(b"\xff\xfe\x00\x81")
    tool = ReadFile(fixtures)

    assert "no such file" in str((await tool.run({"path": "nope.txt"})).error)
    assert "larger than" in str((await tool.run({"path": "big.txt"})).error)
    assert "not UTF-8" in str((await tool.run({"path": "image.bin"})).error)
    assert not (await tool.run({"path": ""})).success


# --------------------------------------------------------------- search_docs


@pytest.fixture
def corpus(tmp_path: Path) -> Path:
    root = tmp_path / "corpus"
    root.mkdir()
    (root / "ferry.md").write_text(
        "# Ferry\n\nThe ferry is run by the Transit Authority.\n\n"
        "## Fleet\n\nThe fleet has three vessels.\n",
        encoding="utf-8",
    )
    (root / "authority.md").write_text(
        "# Transit Authority\n\n## Leadership\n\nThe director is Imani Okafor.\n",
        encoding="utf-8",
    )
    return root


async def test_search_docs_returns_the_best_passage_with_its_source(corpus: Path) -> None:
    result = await SearchDocs(corpus).run({"query": "who is the director"})

    first = result.output.split("\n\n")[0]
    assert first == "[authority] Leadership\nThe director is Imani Okafor."


async def test_search_docs_is_deterministic_and_handles_no_match(corpus: Path) -> None:
    tool = SearchDocs(corpus)

    outputs = {(await tool.run({"query": "transit authority fleet"})).output for _ in range(5)}
    assert len(outputs) == 1
    assert (await tool.run({"query": "zeppelin"})).output == "No matching passages."
    assert not (await tool.run({"query": "  "})).success


async def test_search_docs_finds_the_answer_in_the_real_corpus() -> None:
    result = await SearchDocs(get_settings().corpus_dir).run(
        {"query": "Tidewater Transit Authority director"}
    )

    assert "Imani Okafor" in result.output


async def test_search_docs_on_an_empty_corpus(tmp_path: Path) -> None:
    result = await SearchDocs(tmp_path).run({"query": "anything"})

    assert result.output == "No matching passages."


# --------------------------------------------------------------- python_exec


def sandbox_reply(**body: object) -> httpx.AsyncClient:
    reply = {
        "stdout": "",
        "stderr": "",
        "exit_code": 0,
        "timed_out": False,
        "truncated": False,
        "duration_ms": 5,
        **body,
    }
    return httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=reply))
    )


async def test_python_exec_returns_stdout() -> None:
    tool = PythonExec("http://sandbox", sandbox_reply(stdout="42\n"))

    assert (await tool.run({"code": "print(42)"})).output == "42\n"


async def test_python_exec_reports_a_failed_script_with_its_traceback() -> None:
    tool = PythonExec(
        "http://sandbox",
        sandbox_reply(exit_code=1, stdout="partial\n", stderr="Traceback...\nValueError: boom\n"),
    )

    result = await tool.run({"code": "raise ValueError('boom')"})

    assert not result.success
    assert "ValueError: boom" in str(result.error)
    assert result.output == "partial\n"


async def test_python_exec_reports_a_timeout() -> None:
    tool = PythonExec("http://sandbox", sandbox_reply(timed_out=True, exit_code=None))

    result = await tool.run({"code": "while True: pass"})

    assert not result.success
    assert "timed out" in str(result.error)


async def test_python_exec_reports_sandbox_problems_without_raising() -> None:
    def refuse(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    down = httpx.AsyncClient(transport=httpx.MockTransport(refuse))
    broken = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(500)))
    rejected = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(422)))

    assert "unreachable" in str((await PythonExec("http://s", down).run({"code": "1"})).error)
    assert "HTTP 500" in str((await PythonExec("http://s", broken).run({"code": "1"})).error)
    assert "rejected" in str((await PythonExec("http://s", rejected).run({"code": "1"})).error)
    assert "not configured" in str((await PythonExec(None).run({"code": "1"})).error)
    assert not (await PythonExec("http://s", down).run({"code": ""})).success


async def sandbox_url() -> str:
    """The real sandbox, when this test run can reach it."""
    url = os.environ.get("ARENA_SANDBOX_URL")
    if not url:
        pytest.skip("ARENA_SANDBOX_URL is not set")
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.get(f"{url}/health")
    except httpx.HTTPError:
        pytest.skip("the sandbox is not running")
    return url


async def test_python_exec_runs_code_in_the_real_sandbox() -> None:
    tool = PythonExec(await sandbox_url())

    result = await tool.run(
        {
            "code": "import os, csv\n"
            "rows = list(csv.DictReader(open(os.environ['FIXTURES_DIR'] + '/dev_sales.csv')))\n"
            "print(len(rows))"
        }
    )

    assert result.output == "12\n", result.error


async def test_real_sandbox_blocks_the_network_and_kills_runaway_code() -> None:
    tool = PythonExec(await sandbox_url())

    network = await tool.run(
        {
            "code": "import socket\n"
            "try:\n"
            "    socket.create_connection(('1.1.1.1', 443), timeout=3)\n"
            "    print('REACHED')\n"
            "except OSError:\n"
            "    print('blocked')"
        }
    )
    runaway = await tool.run({"code": "while True:\n    pass"})

    assert network.output == "blocked\n"
    assert not runaway.success and "timed out" in str(runaway.error)
