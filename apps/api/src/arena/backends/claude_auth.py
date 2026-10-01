"""Guards that keep Claude runs on the subscription login and off paid billing.

Claude Code prefers an API key, a bearer token, a custom endpoint, or a cloud
provider over the subscription token whenever one is configured. Any of those
would bill per token. These checks refuse to start, or stop a session at once,
instead of falling back.
"""

from collections.abc import Mapping, Sequence
from typing import Any

# The name of the variable, not a secret.
TOKEN_VARIABLE = "CLAUDE_CODE_OAUTH_TOKEN"

# Each of these outranks the subscription token in Claude Code's credential order.
FORBIDDEN_VARIABLES = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_PROFILE",
    "ANTHROPIC_FEDERATION_RULE_ID",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
)

MCP_SERVER = "arena"
MCP_PREFIX = f"mcp__{MCP_SERVER}__"


class SubscriptionAuthError(Exception):
    """A Claude run cannot be shown to use the subscription login, so it must not run."""


class UsageLimitReachedError(Exception):
    """The subscription's usage limit is exhausted. Not the agent's fault."""

    def __init__(self, message: str, resets_at: int | None) -> None:
        super().__init__(message)
        self.resets_at = resets_at


def check_environment(env: Mapping[str, str]) -> None:
    """Refuse before any process is started."""
    present = [name for name in FORBIDDEN_VARIABLES if env.get(name)]
    if present:
        raise SubscriptionAuthError(
            f"{', '.join(present)} is set. Claude Code would use it instead of the "
            "subscription login and bill a paid API. Remove it from .env and the "
            "environment, then try again."
        )
    if not env.get(TOKEN_VARIABLE):
        raise SubscriptionAuthError(
            f"{TOKEN_VARIABLE} is not set, so there is no subscription login to use. Run "
            "`claude setup-token` on the host and put the token in .env. There is no "
            "fallback to an API key."
        )


def mcp_name(tool: str) -> str:
    """The name a tool has inside the Claude Code session."""
    return f"{MCP_PREFIX}{tool}"


def plain_name(tool: str) -> str:
    """The arena's own name for a tool the session calls `mcp__arena__<name>`."""
    return tool.removeprefix(MCP_PREFIX)


def check_session(init: Mapping[str, Any], expected_tools: Sequence[str]) -> None:
    """Check the session Claude Code actually started, before the first model call."""
    source = init.get("apiKeySource")
    if source != "none":
        raise SubscriptionAuthError(
            f"The session reports an API key source of {source!r}. A subscription login "
            "reports 'none'. Stopping before any model call."
        )
    tools = sorted(init.get("tools") or [])
    expected = sorted(mcp_name(tool) for tool in expected_tools)
    if tools != expected:
        raise SubscriptionAuthError(
            f"The session's tools are {tools}, but only {expected} are allowed. A built-in "
            "tool or another server is present. Stopping before any model call."
        )


def check_rate_limit(info: object) -> None:
    """Inspect the usage status Claude Code reports with each response."""
    overage = getattr(info, "overage_status", None)
    if overage == "allowed":
        raise SubscriptionAuthError(
            "Extra usage is enabled on this Claude account, so going past the plan's "
            "limit would be billed. Turn it off at claude.ai, then try again."
        )
    if getattr(info, "status", None) == "rejected":
        raise UsageLimitReachedError(
            "The Claude subscription's usage limit has been reached.",
            getattr(info, "resets_at", None),
        )
