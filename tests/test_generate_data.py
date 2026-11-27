"""
Sanity tests for the synthetic data. Run:  python3 -m pytest
Checks the generated data stays realistic (a guard against future edits).
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import config  # noqa: E402


def _rows(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def test_training_file_exists():
    assert config.TRAINING_CSV.exists(), "Run: python3 src/generate_data.py first"


def test_resolution_minutes_positive():
    for r in _rows(config.TRAINING_CSV):
        assert int(r["resolution_minutes"]) > 0


def test_person_accident_longer_than_baggage():
    rows = _rows(config.TRAINING_CSV)
    person = [int(r["resolution_minutes"]) for r in rows if r["type_id"] == "person_accident"]
    bag = [int(r["resolution_minutes"]) for r in rows if r["type_id"] == "abandoned_baggage"]
    # Real-world ordering must hold: tragedies take far longer than lost bags.
    assert (sum(person) / len(person)) > (sum(bag) / len(bag))
