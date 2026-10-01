"""No credential may be written to the repository, and the scrubber must catch them all.

The repository is public. This scan covers everything that can be committed:
recordings, findings, recorded test responses, docs, configs, and source.
"""

import os
from pathlib import Path

import pytest

from arena.scrub import REDACTED, SECRET_PATTERNS, scrub, scrub_text, secret_values
from arena.settings import REPO_ROOT

# Never committed, so not scanned: git-ignored folders and the local .env file.
SKIPPED_DIRS = {
    ".git",
    "node_modules",
    ".next",
    ".venv",
    ".dev-dumps",
    ".pnpm-store",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}
SKIPPED_FILES = {".env"}
TEXT_SUFFIXES = {
    ".py", ".ts", ".tsx", ".mjs", ".js", ".json", ".jsonl", ".ndjson", ".yaml", ".yml",
    ".toml", ".md", ".txt", ".css", ".csv", ".example", ".lock", "",
}  # fmt: skip
# Names of files that hold Claude Code or provider credentials.
CREDENTIAL_FILE_NAMES = {".credentials.json", "credentials.json", ".claude.json"}


def committed_files() -> list[Path]:
    files: list[Path] = []
    for folder, subfolders, names in os.walk(REPO_ROOT):
        # Pruned in place, so skipped folders such as node_modules are never entered.
        subfolders[:] = [name for name in subfolders if name not in SKIPPED_DIRS]
        files.extend(Path(folder) / name for name in names if name not in SKIPPED_FILES)
    return files


def test_no_credential_file_is_in_the_repository() -> None:
    found = [
        str(p.relative_to(REPO_ROOT)) for p in committed_files() if p.name in CREDENTIAL_FILE_NAMES
    ]

    assert found == []


def test_no_file_in_the_repository_contains_a_credential() -> None:
    # Built here so that this file does not contain the strings it searches for.
    leaks = []
    for path in committed_files():
        if path.suffix not in TEXT_SUFFIXES or path.stat().st_size > 5_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                leaks.append(f"{path.relative_to(REPO_ROOT)}: {label}")

    assert leaks == []


def fake(prefix: str, body: str = "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hL") -> str:
    """A string with the shape of a credential, assembled so it is not one."""
    return prefix + body


@pytest.mark.parametrize(
    "secret",
    [
        fake("sk-ant-" + "oat01-"),
        fake("sk-ant-" + "ort01-"),
        fake("sk-ant-" + "api03-"),
        fake("gs" + "k_"),
        fake("AI" + "za", "SyD3fG6hJ9kL2mN5pQ8rS1tU4vW7xY0zA3bC6"),
        fake("gh" + "p_"),
        "Bearer " + fake("eyJ"),
        '"access' + 'Token": "' + fake("") + '"',
        '"refresh' + 'Token": "' + fake("") + '"',
        "org_" + "01ks8d2g3kfk0vc8005db7wfs9",
    ],
)
def test_the_scrubber_removes_every_credential_shape(secret: str) -> None:
    cleaned = scrub_text(f"before {secret} after", secrets=[])

    assert secret not in cleaned
    assert REDACTED in cleaned
    assert cleaned.startswith("before ") and cleaned.endswith(" after")


def test_the_scrubber_removes_known_secret_values_of_any_shape() -> None:
    env = {"CLAUDE_CODE_OAUTH_TOKEN": "an-odd-shaped-secret-value", "ARENA_PORT": "8000-not-secret"}

    cleaned = scrub({"a": ["x an-odd-shaped-secret-value y"], "b": 8000}, secret_values(env))

    assert cleaned == {"a": [f"x {REDACTED} y"], "b": 8000}
    assert secret_values(env) == ["an-odd-shaped-secret-value"]


def test_short_values_are_not_treated_as_secrets() -> None:
    # A two-character "token" would blank out ordinary text.
    assert secret_values({"SOME_TOKEN": "ab"}) == []


def test_ordinary_text_is_left_alone() -> None:
    text = "The task asks for 313.03; call_1 used calculator with 37 * 4.85."

    assert scrub_text(text, secrets=[]) == text
