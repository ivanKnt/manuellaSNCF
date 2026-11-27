"""
Phase 4 - Evaluation (this is what earns the grade).

Two jobs:
  1. MODEL QUALITY - is the trained model actually better than the baseline?
       - MAE on the median (lower = closer guesses)
       - COVERAGE: do ~80% of true values fall inside the 0.1-0.9 range?
         (an honest range should contain the truth ~80% of the time)
  2. PRODUCT VALUE - simulate passengers with a connection under 3 info
     strategies and count MISSED CONNECTIONS (the real harm):
         A = silence (today's SNCF)   B = single point ETA   C = range
     Hypothesis: C misses fewest connections at the lowest overall cost.

Run:  python3 src/evaluate.py
"""
from __future__ import annotations

import random

import pandas as pd
from sklearn.model_selection import train_test_split

import baseline
import config
import impact_engine
import predict


def load_test_set():
    """Recreate the EXACT held-out 20% from train.py (same seed = same split)."""
    df = pd.read_csv(config.TRAINING_CSV)
    X = df[config.CATEGORICAL_FEATURES + config.NUMERIC_FEATURES]
    y = df[config.TARGET]
    _, X_test, _, y_test = train_test_split(
        X, y, test_size=0.2, random_state=config.RANDOM_SEED
    )
    return X_test.reset_index(drop=True), y_test.reset_index(drop=True)


def mae(y_true, y_pred) -> float:
    return sum(abs(a - b) for a, b in zip(y_true, y_pred)) / len(y_true)


def coverage(y_true, lows, highs) -> float:
    """Fraction of true values that land inside [low, high]."""
    inside = sum(lo <= t <= hi for t, lo, hi in zip(y_true, lows, highs))
    return inside / len(y_true)


def evaluate_models(X_test, y_test, verbose: bool = True):
    rb = baseline.load_rulebook()
    models = predict.load_models()
    y_true = list(y_test)

    # --- baseline: everything from the type only ---
    b_low, b_med, b_high = [], [], []
    for t in X_test["type_id"]:
        lo, md, hi = baseline.predict_range(t, rb)
        b_low.append(lo); b_med.append(md); b_high.append(hi)

    # --- model: uses all features ---
    m_low, m_med, m_high = [], [], []
    for _, feat in X_test.iterrows():
        r = predict.predict(feat.to_dict(), models)
        m_low.append(r["low"]); m_med.append(r["median"]); m_high.append(r["high"])

    metrics = {
        "n_test": len(y_true),
        "baseline": {"mae": mae(y_true, b_med), "coverage": coverage(y_true, b_low, b_high),
                     "avg_width": sum(h - l for l, h in zip(b_low, b_high)) / len(y_true)},
        "model": {"mae": mae(y_true, m_med), "coverage": coverage(y_true, m_low, m_high),
                  "avg_width": sum(h - l for l, h in zip(m_low, m_high)) / len(y_true)},
    }
    if verbose:
        print(f"{'metric':<22}{'baseline':>12}{'model':>12}")
        print("-" * 46)
        print(f"{'MAE median (min)':<22}{metrics['baseline']['mae']:>12.1f}{metrics['model']['mae']:>12.1f}")
        print(f"{'range coverage':<22}{metrics['baseline']['coverage']:>12.0%}{metrics['model']['coverage']:>12.0%}")
    return {"m_low": m_low, "m_med": m_med, "m_high": m_high, "metrics": metrics}


MISS_COST = 90      # stranded after missing a connection (minutes of harm)
REBOOK_COST = 20    # inconvenience of switching to an alternative
STAY_IF_PROB = 0.8  # strategy C keeps the connection only if >= 80% safe


def passenger_satisfaction_sim(y_test, model_preds, verbose: bool = True) -> dict:
    """Each passenger has a connection with some slack. Each strategy decides:
    keep the connection, or rebook proactively. Missing it is the real harm.

      A - silence:     no info -> always keeps the connection
      B - point ETA:   keeps it if the single median fits in the slack
      C - range:       keeps it only if P(make it) >= 80%
    """
    rng = random.Random(config.RANDOM_SEED)
    stats = {k: {"missed": 0, "cost": 0.0} for k in "ABC"}
    y_true = list(y_test)

    for t, lo, md, hi in zip(y_true, model_preds["m_low"], model_preds["m_med"], model_preds["m_high"]):
        slack = rng.uniform(15, 180)               # minutes of margin before the connection
        r = {"low": lo, "median": md, "high": hi}
        keeps = {
            "A": True,
            "B": md <= slack,
            "C": impact_engine.prob_delay_at_most(slack, r) >= STAY_IF_PROB,
        }
        would_miss = t > slack
        for k, keep in keeps.items():
            if keep and would_miss:
                stats[k]["missed"] += 1
                stats[k]["cost"] += MISS_COST
            elif not keep:
                stats[k]["cost"] += REBOOK_COST

    n = len(y_true)
    labels = {"A": "A - silence (SNCF today)", "B": "B - single point ETA", "C": "C - range (our system)"}
    result = {k: {"label": labels[k], "missed_rate": stats[k]["missed"] / n, "avg_cost": stats[k]["cost"] / n}
              for k in "ABC"}
    if verbose:
        print(f"\n{'strategy':<28}{'missed connections':>20}{'avg cost (min)':>16}")
        print("-" * 64)
        for k in "ABC":
            print(f"{labels[k]:<28}{result[k]['missed_rate']:>20.0%}{result[k]['avg_cost']:>16.1f}")
    return result


def main() -> None:
    X_test, y_test = load_test_set()
    print(f"Evaluating on {len(y_test)} unseen incidents.\n")
    model_preds = evaluate_models(X_test, y_test)
    passenger_satisfaction_sim(y_test, model_preds)


if __name__ == "__main__":
    main()
