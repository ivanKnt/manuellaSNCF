"""
Phase 1c - Predict a resolution-time RANGE for a new incident.

Loads the trained quantile models and returns the honest low/median/high.
This is the function the rest of the system (journey engine, narrator) calls.

    predict({"type_id": "animal_strike", "track_layout": "single",
             "weather": "storm", ...}) -> {"low": 41, "median": 72, "high": 150}
"""
from __future__ import annotations

import joblib
import pandas as pd

import config

_FEATURES = config.CATEGORICAL_FEATURES + config.NUMERIC_FEATURES


def load_models() -> dict[float, object]:
    """Load the three fitted quantile pipelines from models/."""
    return {q: joblib.load(config.MODELS_DIR / f"model_q{q}.joblib") for q in config.QUANTILES}


def predict(incident: dict, models: dict | None = None) -> dict:
    """Return {"low", "median", "high"} minutes for one incident dict."""
    if models is None:
        models = load_models()

    # The model expects a one-row table with exactly the feature columns.
    row = pd.DataFrame([{col: incident.get(col) for col in _FEATURES}])

    preds = [float(models[q].predict(row)[0]) for q in config.QUANTILES]
    # Quantile models are trained independently, so occasionally the 0.1 line
    # can creep above the 0.5 line ("quantile crossing"). Sorting repairs it
    # and guarantees low <= median <= high.
    low, median, high = sorted(preds)
    return {"low": round(low), "median": round(median), "high": round(high)}


if __name__ == "__main__":
    models = load_models()
    examples = [
        {"type_id": "animal_strike", "category": "external", "tracks_blocked": "one",
         "line_type": "TER", "track_layout": "single", "zone": "rural",
         "near_depot": "no", "day_type": "weekday", "time_of_day": "rush_pm",
         "weather": "storm", "length_km": 11},
        {"type_id": "animal_strike", "category": "external", "tracks_blocked": "one",
         "line_type": "TGV", "track_layout": "double", "zone": "urban",
         "near_depot": "yes", "day_type": "weekday", "time_of_day": "midday",
         "weather": "clear", "length_km": 0},
    ]
    for ex in examples:
        r = predict(ex, models)
        print(f"{ex['type_id']:<15} {ex['track_layout']:<7} {ex['weather']:<6}"
              f" -> {r['low']}-{r['high']} min (≈{r['median']})")
