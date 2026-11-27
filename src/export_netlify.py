"""
Build the file the Netlify site actually runs.

Netlify cannot host the FastAPI server: scikit-learn and its libraries are
larger than a function is allowed to be. This script trains nothing by itself.
It reads the three models already saved in models/ and writes app/sim/bundle.json:

  - the real timetable (data/routes.json)
  - the incident rulebook
  - the three boosted-tree models, as plain numbers
  - the report (sources, metrics), computed once here

The browser (app/sim/engine.js) then answers /api/journey and /api/incident
itself. Run automatically by the Netlify build, or by hand:

    python3 src/export_netlify.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import config  # noqa: E402
import generate_data  # noqa: E402
import report  # noqa: E402
import simulation  # noqa: E402

OUT = ROOT / "app" / "sim" / "bundle.json"


def _tree(tree) -> dict:
    t = tree.tree_
    return {
        "feature": [int(x) for x in t.feature],
        "threshold": [round(float(x), 6) for x in t.threshold],
        "left": [int(x) for x in t.children_left],
        "right": [int(x) for x in t.children_right],
        "value": [round(float(v[0][0]), 6) for v in t.value],
    }


def _model(quantile: float) -> dict:
    pipe = joblib.load(config.MODELS_DIR / f"model_q{quantile}.joblib")
    gb = pipe.named_steps["model"]
    enc = pipe.named_steps["preprocess"].named_transformers_["cat"]
    return {
        "q": quantile,
        "init": float(gb.init_.constant_[0][0]),
        "learning_rate": float(gb.learning_rate),
        "trees": [_tree(gb.estimators_[i, 0]) for i in range(gb.n_estimators_)],
        "categories": [list(cats) for cats in enc.categories_],
    }


def main() -> None:
    missing = [q for q in config.QUANTILES if not (config.MODELS_DIR / f"model_q{q}.joblib").exists()]
    if missing:
        raise SystemExit(f"Missing models {missing}. Run: python3 src/train.py")
    if not simulation.ROUTES_JSON.exists():
        raise SystemExit("Missing data/routes.json. Run: python3 src/build_routes.py")

    rulebook = {}
    for type_id, row in __import__("baseline").load_rulebook().items():
        rulebook[type_id] = {
            **row,
            "dur_min": int(row["dur_min"]),
            "dur_median": int(row["dur_median"]),
            "dur_max": int(row["dur_max"]),
        }
    bundle = {
        "routes": json.loads(simulation.ROUTES_JSON.read_text(encoding="utf-8")),
        "rulebook": rulebook,
        "type_weights": generate_data.TYPE_WEIGHTS,
        "weather_weights": generate_data.WEATHER_WEIGHTS,
        "cat_names": config.CATEGORICAL_FEATURES,
        "num_names": config.NUMERIC_FEATURES,
        "models": [_model(q) for q in config.QUANTILES],
        "report": report.build(),
        "assumptions": {
            "urban_radius_km": simulation.URBAN_RADIUS_KM,
            "depot_radius_km": simulation.DEPOT_RADIUS_KM,
            "booking_min_transfer": simulation.BOOKING_MIN_TRANSFER,
            "transfer_walk_min": simulation.TRANSFER_WALK_MIN,
            "rebook_below": simulation.REBOOK_BELOW,
        },
    }
    OUT.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
