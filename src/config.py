"""
Central configuration: paths, feature definitions, and tuning knobs.
Every other module imports from here so there are no hard-coded paths.
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

# --- Paths ------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]

# Secrets live in a .env file at the project root (never committed to git).
_ENV_FILE = PROJECT_ROOT / ".env"
if _ENV_FILE.exists():
    for _line in _ENV_FILE.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _key, _value = _line.split("=", 1)
            os.environ.setdefault(_key.strip(), _value.strip().strip("\"'"))
DATA_DIR = PROJECT_ROOT / "data"
MODELS_DIR = PROJECT_ROOT / "models"

# Reference tables (hand-built, real SNCF figures)
INCIDENT_TYPES_CSV = DATA_DIR / "incident_types.csv"
NETWORK_CSV = DATA_DIR / "network.csv"

# Generated tables (produced by src/generate_data.py)
INCIDENTS_CSV = DATA_DIR / "incidents.csv"
IMPACT_CSV = DATA_DIR / "impact.csv"
TRAINING_CSV = DATA_DIR / "training_data.csv"

# --- Data generation knobs --------------------------------------------------
RANDOM_SEED = 42
N_INCIDENTS = 3000
GEN_START_DATE = datetime(2026, 1, 1)
GEN_DAYS_SPAN = 180

# --- Model features ---------------------------------------------------------
# What the model is allowed to look at (features) and what it predicts (target).
CATEGORICAL_FEATURES = [
    "type_id", "category", "tracks_blocked", "line_type",
    "track_layout", "zone", "near_depot", "time_of_day",
    "day_type", "weather",
]
NUMERIC_FEATURES = ["length_km"]
TARGET = "resolution_minutes"

# Quantiles we predict to express a RANGE instead of a single number.
# 0.5 = median estimate, 0.1 / 0.9 = the honest low/high bounds.
QUANTILES = [0.1, 0.5, 0.9]

# --- Live SNCF data (Phase: real ingestion) ---------------------------------
GTFS_RT_SERVICE_ALERTS = "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts"
GTFS_RT_TRIP_UPDATES = "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates"
SNCF_API_BASE = "https://api.sncf.com/v1/coverage/sncf"  # needs a free token

# --- Language model (Phase 3 narrator) --------------------------------------
# Groq free plan, OpenAI-compatible API. Free models (Nov 2026):
# openai/gpt-oss-20b, openai/gpt-oss-120b, qwen/qwen3.8-27b - 1,000 requests/day each.
LLM_BASE_URL = "https://api.groq.com/openai/v1"
LLM_MODEL = "openai/gpt-oss-20b"
LLM_API_KEY_ENV = "GROQ_API_KEY"
