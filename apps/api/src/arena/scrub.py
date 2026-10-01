"""Keeps credentials out of anything the arena writes: traces, recordings, logs.

Two layers. Known secret values are taken from the environment and removed by
exact match. Anything shaped like a provider credential is removed by pattern,
in case a secret reached us some other way.
"""

import os
import re
from collections.abc import Mapping
from typing import Any

REDACTED = "<redacted>"
MIN_SECRET_LENGTH = 8
_SECRET_NAME = re.compile(r"KEY|TOKEN|SECRET|PASSWORD", re.IGNORECASE)

# Shapes of credentials that must never be stored. Used by scrub() and by the
# repository scan in tests/test_no_secrets.py.
SECRET_PATTERNS: dict[str, re.Pattern[str]] = {
    "Anthropic key or Claude OAuth token": re.compile(r"sk-ant-[A-Za-z0-9_-]{16,}"),
    "Groq key": re.compile(r"gsk_[A-Za-z0-9]{20,}"),
    "Google API key": re.compile(r"AIza[0-9A-Za-z_-]{30,}"),
    "OpenAI key": re.compile(r"sk-(?:proj-)?[A-Za-z0-9]{32,}"),
    "GitHub token": re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    "bearer token": re.compile(r"[Bb]earer\s+[A-Za-z0-9._-]{24,}"),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    # The contents of Claude Code's credentials file.
    "Claude credentials": re.compile(
        r"\"(?:claudeAiOauth|accessToken|refreshToken)\"\s*:\s*\"[^\"]{8,}\""
    ),
    "account id": re.compile(r"org_[0-9][A-Za-z0-9]{12,}"),
}


def secret_values(env: Mapping[str, str] | None = None) -> list[str]:
    """Values of environment variables whose names mark them as secrets."""
    source = os.environ if env is None else env
    values = {
        value
        for name, value in source.items()
        if _SECRET_NAME.search(name) and len(value) >= MIN_SECRET_LENGTH
    }
    # Longest first, so a secret that contains another is removed whole.
    return sorted(values, key=len, reverse=True)


def scrub_text(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret in text:
            text = text.replace(secret, REDACTED)
    for pattern in SECRET_PATTERNS.values():
        text = pattern.sub(REDACTED, text)
    return text


def scrub(value: Any, secrets: list[str] | None = None) -> Any:  # noqa: ANN401
    """A copy of `value` with every credential removed from every string in it."""
    known = secret_values() if secrets is None else secrets
    if isinstance(value, str):
        return scrub_text(value, known)
    if isinstance(value, list):
        return [scrub(item, known) for item in value]
    if isinstance(value, dict):
        return {key: scrub(item, known) for key, item in value.items()}
    return value
