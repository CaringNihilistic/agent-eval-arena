"""Shared test setup."""

import pytest

# Credentials for real providers. The api container has them in its environment
# for live runs; no test may use them.
REAL_CREDENTIALS = (
    "CLAUDE_CODE_OAUTH_TOKEN",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GROQ_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
)


@pytest.fixture(autouse=True)
def no_real_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove every provider credential, so a test that reached for a real model
    would fail instead of spending the owner's quota."""
    for name in REAL_CREDENTIALS:
        monkeypatch.delenv(name, raising=False)
