"""
Phase 1b - Train the prediction model.

Learns features -> resolution_minutes from data/training_data.csv.
We fit ONE model per quantile (config.QUANTILES = 0.1 / 0.5 / 0.9) so the output
is an honest RANGE (low / median / high), not a single number.
Fitted models are saved to models/.

Run:  python3 src/train.py
"""
from __future__ import annotations

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

import config


def load_training_data():
    """Load training_data.csv and split into X (features) and y (target)."""
    df = pd.read_csv(config.TRAINING_CSV)
    feature_cols = config.CATEGORICAL_FEATURES + config.NUMERIC_FEATURES
    X = df[feature_cols]            # every column EXCEPT the label
    y = df[config.TARGET]          # resolution_minutes
    return X, y


def build_pipeline(quantile: float) -> Pipeline:
    """Preprocessing (one-hot encode categoricals) + a quantile regressor."""
    preprocess = ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore"), config.CATEGORICAL_FEATURES),
            ("num", "passthrough", config.NUMERIC_FEATURES),
        ]
    )
    model = GradientBoostingRegressor(loss="quantile", alpha=quantile, random_state=config.RANDOM_SEED)
    return Pipeline([("preprocess", preprocess), ("model", model)])


def main() -> None:
    X, y = load_training_data()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=config.RANDOM_SEED
    )
    print(f"Training on {len(X_train)} rows, holding out {len(X_test)} for testing.")

    config.MODELS_DIR.mkdir(exist_ok=True)
    for q in config.QUANTILES:
        pipe = build_pipeline(q)
        pipe.fit(X_train, y_train)
        out = config.MODELS_DIR / f"model_q{q}.joblib"
        joblib.dump(pipe, out)
        print(f"  fitted quantile {q} -> saved {out.name}")

    print("Done. Three models = your low / median / high range.")


if __name__ == "__main__":
    main()
