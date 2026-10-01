"""The pricing table and the guard that keeps the project at $0."""

from datetime import date

import pytest

from arena.config import load_configs
from arena.pricing import (
    ModelNotAllowedError,
    actual_cost_usd,
    assert_runnable,
    default_pricing,
    reference_cost_usd,
)
from arena.settings import get_settings
from tests.fakes import make_pricing


def test_every_entry_in_the_real_table_cites_an_official_source_and_date() -> None:
    table = default_pricing()

    assert table.models
    for name, entry in table.models.items():
        assert entry.reference.source.startswith("https://"), name
        assert entry.reference.checked >= date(2026, 10, 1), name
        if entry.billing == "free":
            assert entry.free_tier is not None, name
            assert entry.free_tier.source.startswith("https://"), name


def test_no_model_in_the_real_table_is_billed_per_token() -> None:
    assert {entry.billing for entry in default_pricing().models.values()} <= {
        "free",
        "subscription",
    }


def test_every_committed_config_is_runnable_without_any_override() -> None:
    configs = load_configs(get_settings().configs_dir)

    assert len(configs) >= 4
    for config in configs.values():
        entry = assert_runnable(default_pricing(), config.model, config.backend, allow_paid=False)
        assert entry.provider == config.provider


def test_free_and_subscription_models_may_run() -> None:
    table = make_pricing()

    assert assert_runnable(table, "test/free-model", "litellm", allow_paid=False).billing == "free"
    assert (
        assert_runnable(table, "test/subscription-model", "agent_sdk", allow_paid=False).billing
        == "subscription"
    )


def test_a_paid_model_is_refused_unless_explicitly_allowed() -> None:
    table = make_pricing()

    with pytest.raises(ModelNotAllowedError, match="must cost \\$0"):
        assert_runnable(table, "test/paid-model", "litellm", allow_paid=False)
    assert assert_runnable(table, "test/paid-model", "litellm", allow_paid=True).billing == "paid"


def test_a_model_without_an_entry_is_always_refused() -> None:
    table = make_pricing()

    for allow_paid in (False, True):
        with pytest.raises(ModelNotAllowedError, match="no entry in the pricing table"):
            assert_runnable(table, "anthropic/some-model", "litellm", allow_paid=allow_paid)


def test_a_subscription_model_cannot_be_reached_through_the_api_backend() -> None:
    table = make_pricing()

    for allow_paid in (False, True):
        with pytest.raises(ModelNotAllowedError, match="only run on the agent_sdk backend"):
            assert_runnable(table, "test/subscription-model", "litellm", allow_paid=allow_paid)


def test_reference_cost_uses_list_prices() -> None:
    entry = make_pricing().models["test/free-model"]

    cost = reference_cost_usd(entry, prompt_tokens=10_000, completion_tokens=2_000)

    assert cost == pytest.approx(10_000 * 1 / 1e6 + 2_000 * 5 / 1e6)


def test_reference_cost_prices_cached_tokens_at_the_cache_rates() -> None:
    entry = make_pricing().models["test/subscription-model"]

    cost = reference_cost_usd(
        entry,
        prompt_tokens=10_000,
        completion_tokens=1_000,
        cache_read_tokens=6_000,
        cache_write_tokens=3_000,
    )

    # 1,000 uncached at $2, 6,000 read at $0.20, 3,000 written at $2.50, 1,000 out at $10.
    assert cost == pytest.approx((1_000 * 2 + 6_000 * 0.2 + 3_000 * 2.5 + 1_000 * 10) / 1e6)


def test_cached_tokens_fall_back_to_the_input_rate_when_no_cache_price_is_listed() -> None:
    entry = make_pricing().models["test/free-model"]

    with_cache = reference_cost_usd(
        entry, prompt_tokens=1_000, completion_tokens=0, cache_read_tokens=400
    )

    assert with_cache == reference_cost_usd(entry, prompt_tokens=1_000, completion_tokens=0)


def test_actual_cost_is_zero_unless_the_model_is_paid() -> None:
    table = make_pricing()

    assert actual_cost_usd(table.models["test/free-model"], 0.25) == 0.0
    assert actual_cost_usd(table.models["test/subscription-model"], 0.25) == 0.0
    assert actual_cost_usd(table.models["test/paid-model"], 0.25) == 0.25
