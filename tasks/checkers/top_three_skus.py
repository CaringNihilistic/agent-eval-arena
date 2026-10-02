"""Checker for answers that list SKUs in rank order.

Runs inside the sandbox. `check` receives the agent's answer and the task's
scorer_config, and returns (passed, explanation).
"""

import re


def check(answer: str, config: dict) -> tuple[bool, str]:
    expected = [sku.upper() for sku in config["expected"]]
    found = [sku.upper() for sku in re.findall(r"SKU-\d{3}", answer, flags=re.IGNORECASE)]
    if len(found) != len(expected):
        return False, f"Expected {len(expected)} SKUs, found {len(found)} in the answer."
    if found == expected:
        return True, "The SKUs match, in the right order."
    if sorted(found) == sorted(expected):
        return False, "The right SKUs, but not in order of stock value."
    return False, "At least one SKU is not among the top three by stock value."
