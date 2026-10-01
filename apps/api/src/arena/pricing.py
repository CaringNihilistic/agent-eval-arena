"""Pricing table, cost calculation, and the guard that keeps the project at $0."""

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

Billing = Literal["free", "subscription", "paid"]
Backend = Literal["litellm", "agent_sdk"]

DEFAULT_TABLE = Path(__file__).parent / "data" / "pricing.yaml"
PER_MTOK = 1_000_000


class ReferencePrice(BaseModel):
    """The provider's paid list price, in USD per million tokens."""

    model_config = ConfigDict(extra="forbid")

    input_per_mtok: float = Field(ge=0)
    output_per_mtok: float = Field(ge=0)
    cache_read_per_mtok: float | None = Field(default=None, ge=0)
    cache_write_per_mtok: float | None = Field(default=None, ge=0)
    source: str
    checked: date
    note: str | None = None


class FreeTierLimits(BaseModel):
    """Rate limits of the free tier. Null means not yet known."""

    model_config = ConfigDict(extra="forbid")

    source: str
    checked: date
    note: str | None = None
    requests_per_minute: int | None = Field(default=None, gt=0)
    requests_per_day: int | None = Field(default=None, gt=0)
    tokens_per_minute: int | None = Field(default=None, gt=0)
    tokens_per_day: int | None = Field(default=None, gt=0)


class ModelEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    billing: Billing
    backends: list[Backend] = Field(min_length=1)
    reference: ReferencePrice
    free_tier: FreeTierLimits | None = None


class PricingTable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    models: dict[str, ModelEntry]


class ModelNotAllowedError(Exception):
    """The requested model may not be called under the zero-cost rule."""


def load_pricing(path: Path = DEFAULT_TABLE) -> PricingTable:
    return PricingTable.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


@lru_cache
def default_pricing() -> PricingTable:
    return load_pricing()


def assert_runnable(
    table: PricingTable, model: str, backend: Backend, *, allow_paid: bool
) -> ModelEntry:
    """Return the model's entry, or refuse.

    A model may run only if it is marked free or subscription. `allow_paid` lifts
    that for paid models; it never lifts the need for an entry, because without
    one the cost of a call cannot be known.
    """
    entry = table.models.get(model)
    if entry is None:
        raise ModelNotAllowedError(
            f"Model {model!r} has no entry in the pricing table, so it cannot be shown to be "
            "free. Add it to pricing.yaml with its billing type and official source."
        )
    if backend not in entry.backends:
        raise ModelNotAllowedError(
            f"Model {model!r} may only run on the {' or '.join(entry.backends)} backend, "
            f"not {backend!r}. Running it here could bill a paid API."
        )
    if entry.billing == "paid" and not allow_paid:
        raise ModelNotAllowedError(
            f"Model {model!r} is billed per token and this project must cost $0. "
            "Use a model marked free or subscription. To run it anyway, pass --allow-paid "
            "or set ARENA_ALLOW_PAID_MODELS=1; that can cost money."
        )
    return entry


def reference_cost_usd(
    entry: ModelEntry,
    *,
    prompt_tokens: int,
    completion_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    """What these tokens would cost at the paid list price.

    `prompt_tokens` counts all input tokens, cached or not. Cached tokens are
    priced at the cache rates when the table has them, otherwise at the input rate.
    """
    price = entry.reference
    read_rate = price.cache_read_per_mtok
    write_rate = price.cache_write_per_mtok
    read_rate = price.input_per_mtok if read_rate is None else read_rate
    write_rate = price.input_per_mtok if write_rate is None else write_rate
    uncached = max(prompt_tokens - cache_read_tokens - cache_write_tokens, 0)
    total = (
        uncached * price.input_per_mtok
        + cache_read_tokens * read_rate
        + cache_write_tokens * write_rate
        + completion_tokens * price.output_per_mtok
    )
    return round(total / PER_MTOK, 8)


def actual_cost_usd(entry: ModelEntry, reference_cost: float) -> float:
    """What was really charged: nothing on a free tier or a subscription."""
    return reference_cost if entry.billing == "paid" else 0.0
