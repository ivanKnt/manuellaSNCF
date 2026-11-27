"""
Phase 1a - Non-ML baseline.

The simplest possible "predictor": look up the typical range for the incident
type in the rulebook. If our trained model can't beat THIS, the model isn't
earning its place. Always build the baseline first.

    predict_range("animal_strike") -> (20, 45, 120)   # (low, median, high)
"""
from __future__ import annotations

import csv

import config


def load_rulebook() -> dict[str, dict]:
    """Read incident_types.csv into a dict keyed by type_id.

    Returns something like:
        {"animal_strike": {"dur_min": "20", "dur_median": "45", ...}, ...}
    We load it once and reuse it, instead of re-reading the file every call.
    """
    with open(config.INCIDENT_TYPES_CSV, newline="") as f:
        return {row["type_id"]: row for row in csv.DictReader(f)}


def predict_range(type_id: str, rulebook: dict | None = None) -> tuple[int, int, int]:
    """Return (low, median, high) minutes for an incident type.

    This is the entire 'model': one dictionary lookup, no learning.
    `rulebook` is optional so callers can pass a preloaded one (faster in loops).
    """
    if rulebook is None:
        rulebook = load_rulebook()

    if type_id not in rulebook:
        raise KeyError(f"Unknown incident type: {type_id!r}")

    row = rulebook[type_id]
    low = int(row["dur_min"])
    median = int(row["dur_median"])
    high = int(row["dur_max"])
    return low, median, high


def main() -> None:
    """Print the baseline range for every incident type (a quick sanity view)."""
    rulebook = load_rulebook()
    print(f"{'incident type':<20}{'low':>6}{'median':>8}{'high':>6}")
    print("-" * 40)
    for type_id in rulebook:
        low, median, high = predict_range(type_id, rulebook)
        print(f"{type_id:<20}{low:>6}{median:>8}{high:>6}")


if __name__ == "__main__":
    main()
