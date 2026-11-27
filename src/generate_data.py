"""
Phase 0 - Synthetic incident generator.

There is no public SNCF dataset logging "incident started at X, cleared at Y,
cause = Z". So we generate one, CALIBRATED to real SNCF figures stored in
data/incident_types.csv (durations) and data/network.csv (the map).

Outputs (in data/):
  - incidents.csv      : event log (one row per incident) + the label
  - impact.csv         : one incident -> many delayed trains (the cascade)
  - training_data.csv  : flat table the model learns from (leakage removed)

Run:  python3 src/generate_data.py
"""
from __future__ import annotations

import csv
import random
from datetime import timedelta

import config

random.seed(config.RANDOM_SEED)  # reproducible: same data every run

# How often each incident type happens (relative weights). A modeling choice:
# mundane stuff common, tragedies/floods rare. Documented as non-sourced.
TYPE_WEIGHTS = {
    "animal_strike": 18, "abandoned_baggage": 16, "rolling_stock": 16,
    "staff_absent": 12, "signalling_failure": 9, "switch_failure": 7,
    "works_overrun": 7, "tree_on_track": 5, "broken_rail": 4,
    "catenary_damage": 3, "person_accident": 2, "flooding": 1,
}
TIME_BUCKETS = {  # name: (start hour, end hour, weight)
    "rush_am": (6, 9, 20), "midday": (9, 16, 30), "rush_pm": (16, 19, 22),
    "evening": (19, 23, 18), "night": (23, 30, 10),
}
WEATHER_WEIGHTS = {"clear": 62, "rain": 20, "storm": 8, "heat": 6, "snow": 4}


def load_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def weighted_choice(weight_map):
    return random.choices(list(weight_map), weights=list(weight_map.values()), k=1)[0]


def sample_time_of_day():
    weights = {k: v[2] for k, v in TIME_BUCKETS.items()}
    bucket = weighted_choice(weights)
    start_h, end_h, _ = TIME_BUCKETS[bucket]
    return bucket, random.randrange(start_h, end_h) % 24, random.randrange(0, 60)


def duration_multiplier(itype, seg, weather, tod):
    """Context nudges on the base duration. Each factor is small and explainable."""
    m = 1.0
    if seg["track_layout"] == "single":
        m *= 1.20                     # no overtaking, harder crew access
    if seg["near_depot"] == "no":
        m *= 1.15                     # crew travel time
    if seg["zone"] == "rural":
        m *= 1.05
    if weather in ("storm", "snow") and itype["category"] in ("weather", "infrastructure"):
        m *= 1.25
    if itype["type_id"] == "person_accident" and seg["line_type"] == "TGV":
        m *= 1.20                     # real SNCF: ~3h on LGV vs ~2h otherwise
    if tod in ("rush_am", "rush_pm"):
        m *= 1.08
    return m


def sample_resolution_minutes(itype, seg, weather, tod):
    lo, mode, hi = float(itype["dur_min"]), float(itype["dur_median"]), float(itype["dur_max"])
    val = random.triangular(lo, hi, mode) * duration_multiplier(itype, seg, weather, tod)
    return int(round(max(lo, min(val, hi * 1.5))))


def _prefix(line_id):
    return "TGV" if line_id.startswith("TGV") else "TER"


def cascade_rows(incident_id, line_id, itype, resolution_minutes, tod):
    rows = []
    primary = int(round(resolution_minutes * random.uniform(0.85, 1.0)))
    rows.append((incident_id, f"{_prefix(line_id)}-{random.randint(1000, 9999)}", "true", primary, 0))
    base = {"rush_am": 4, "rush_pm": 5, "midday": 2, "evening": 1, "night": 0}[tod]
    if itype["tracks_blocked"] in ("both", "sector"):
        base += 2
    n = max(0, base + random.randint(-1, 1))
    decay = 0.55 if itype["tracks_blocked"] in ("both", "sector") else 0.45
    delay = primary
    for rank in range(1, n + 1):
        delay = int(round(delay * decay))
        if delay < 5:
            break
        rows.append((incident_id, f"{_prefix(line_id)}-{random.randint(1000, 9999)}", "false", delay, rank))
    return rows


def main():
    types = {t["type_id"]: t for t in load_csv(config.INCIDENT_TYPES_CSV)}
    segments = load_csv(config.NETWORK_CSV)
    incidents, impact = [], []

    for incident_id in range(1, config.N_INCIDENTS + 1):
        itype = types[weighted_choice(TYPE_WEIGHTS)]
        seg = random.choice(segments)
        weather = weighted_choice(WEATHER_WEIGHTS)
        tod, hour, minute = sample_time_of_day()
        start = config.GEN_START_DATE + timedelta(
            days=random.randrange(config.GEN_DAYS_SPAN), hours=hour, minutes=minute)
        res_min = sample_resolution_minutes(itype, seg, weather, tod)

        incidents.append({
            "incident_id": incident_id, "type_id": itype["type_id"],
            "start_time": start.strftime("%Y-%m-%dT%H:%M"),
            "resolved_time": (start + timedelta(minutes=res_min)).strftime("%Y-%m-%dT%H:%M"),
            "line_id": seg["line_id"], "segment_id": seg["segment_id"],
            "time_of_day": tod, "day_type": "weekend" if start.weekday() >= 5 else "weekday",
            "weather": weather, "resolution_minutes": res_min,
        })
        impact.extend(cascade_rows(incident_id, seg["line_id"], itype, res_min, tod))

    _write(config.INCIDENTS_CSV, incidents, list(incidents[0]))
    _write(config.IMPACT_CSV,
           [dict(zip(["incident_id", "affected_trip_id", "is_primary", "delay_minutes", "cascade_rank"], r))
            for r in impact],
           ["incident_id", "affected_trip_id", "is_primary", "delay_minutes", "cascade_rank"])
    _write_training(incidents, types, segments)
    print(f"Generated {len(incidents)} incidents and {len(impact)} impacted trains.")


def _write_training(incidents, types, segments):
    seg_by_id = {s["segment_id"]: s for s in segments}
    rows = []
    for inc in incidents:
        itype, seg = types[inc["type_id"]], seg_by_id[inc["segment_id"]]
        rows.append({
            "type_id": inc["type_id"], "category": itype["category"],
            "tracks_blocked": itype["tracks_blocked"], "line_type": seg["line_type"],
            "track_layout": seg["track_layout"], "zone": seg["zone"],
            "near_depot": seg["near_depot"], "length_km": seg["length_km"],
            "time_of_day": inc["time_of_day"], "day_type": inc["day_type"],
            "weather": inc["weather"], "resolution_minutes": inc["resolution_minutes"],
        })
    _write(config.TRAINING_CSV, rows, list(rows[0]))


def _write(path, rows, fieldnames):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
