"""
Phase 5b - The numbers behind the in-app report.

Everything the simulation's "Report" panel shows is computed here, from the
project's own files, so the report can never drift away from the code:
sources, the rulebook, how the synthetic data was made, the model's settings,
and the evaluation results.

Run:  python3 src/report.py     (prints the summary)
"""
from __future__ import annotations

import json
from datetime import timedelta

import pandas as pd

import baseline
import config
import evaluate
import generate_data
import simulation

# Real, dated statistics computed by RetardTrain.fr from SNCF's real-time feed.
# Copied by hand on 2026-11-27 from the page below (it is recalculated hourly).
REAL_WORLD_SNAPSHOT = {
    "source_url": "https://retardtrain.fr/guides/causes-retards-trains",
    "period": "2026-10-29 to 2026-11-27 (30 days)",
    "period_fr": "du 2026-10-29 au 2026-11-27 (30 jours)",
    "copied_on": "2026-11-27",
    "disrupted_trains": 37272,
    "share_without_cause": 0.32,
    "avg_delay_by_type": {"TER": 25, "TGV INOUI": 29, "OUIGO": 32, "INTERCITÉS": 39},
    "share_disrupted_by_type": {"TER": 0.142, "TGV INOUI": 0.241, "OUIGO": 0.266, "INTERCITÉS": 0.426},
}

FEATURE_DESCRIPTIONS = {
    "type_id": "What happened (one of the 12 incident types).",
    "category": "Family of the incident (external, security, infrastructure...). Comes with the type.",
    "tracks_blocked": "How much is blocked: one track, both, a whole sector, a station, only the train...",
    "line_type": "TGV (high-speed) or TER (regional).",
    "track_layout": "single or double track. On single track, nothing can go around the problem.",
    "zone": "urban or rural: how easy it is for teams to reach the spot.",
    "near_depot": "Is a maintenance base close (yes/no): crew travel time.",
    "length_km": "Length of the section between the two stations.",
    "time_of_day": "rush_am, midday, rush_pm, evening, night.",
    "day_type": "weekday or weekend.",
    "weather": "clear, rain, storm, heat, snow.",
}

FEATURE_DESCRIPTIONS_FR = {
    "type_id": "Ce qui s'est passé (un des 12 types d'incident).",
    "category": "Famille de l'incident (externe, sûreté, infrastructure...). Vient avec le type.",
    "tracks_blocked": "Ce qui est bloqué : une voie, les deux, tout un secteur, une gare, seulement le train...",
    "line_type": "TGV (grande vitesse) ou TER (régional).",
    "track_layout": "voie unique (single) ou double voie (double). Sur voie unique, rien ne peut contourner le problème.",
    "zone": "urbaine (urban) ou rurale (rural) : la facilité d'accès pour les équipes.",
    "near_depot": "Une base de maintenance est-elle proche (yes/no) : temps de trajet de l'équipe.",
    "length_km": "Longueur du tronçon entre les deux gares.",
    "time_of_day": "rush_am (pointe du matin), midday (journée), rush_pm (pointe du soir), evening (soirée), night (nuit).",
    "day_type": "weekday (semaine) ou weekend.",
    "weather": "clear (dégagé), rain (pluie), storm (tempête), heat (canicule), snow (neige).",
}

# French name and reason for each rule below, in the same order.
GENERATOR_RULES_FR = [
    ("Voie unique", "rien ne peut contourner le problème ; les équipes sont plus difficiles à acheminer"),
    ("Pas de base de maintenance proche", "l'équipe de réparation doit se déplacer"),
    ("Campagne", "accès par la route plus lent"),
    ("Tempête ou neige sur un incident météo ou d'infrastructure", "le travail est plus lent et plus risqué par mauvais temps"),
    ("Personne sur la voie sur une ligne TGV", "SNCF : 3 h sur les lignes à grande vitesse contre 2 h ailleurs"),
    ("Heure de pointe", "plus de trains gênés, plus difficile à dégager"),
]

PASSENGER_LABELS_FR = {"A": "A - silence (SNCF aujourd'hui)", "B": "B - une seule heure estimée",
                       "C": "C - fourchette (notre système)"}

GENERATOR_RULES = [
    ("Single track", 1.20, "track_layout = single", "nothing can go around the problem; teams are harder to bring in"),
    ("No maintenance base nearby", 1.15, "near_depot = no", "the repair crew must travel"),
    ("Countryside", 1.05, "zone = rural", "slower access by road"),
    ("Storm or snow on a weather/infrastructure incident", 1.25, "weather in (storm, snow)",
     "work is slower and riskier in bad weather"),
    ("Person on the track on a TGV line", 1.20, "person_accident and line_type = TGV",
     "SNCF: 3 h on high-speed lines vs 2 h elsewhere"),
    ("Rush hour", 1.08, "time_of_day in (rush_am, rush_pm)", "more trains in the way, harder to clear"),
]


def training_summary() -> dict:
    inc = pd.read_csv(config.INCIDENTS_CSV)
    train = pd.read_csv(config.TRAINING_CSV)
    by_type = (train.groupby("type_id")[config.TARGET]
               .agg(count="count", p10=lambda s: s.quantile(0.1), median="median", p90=lambda s: s.quantile(0.9))
               .round(0).astype(int).reset_index().to_dict("records"))
    example = inc.iloc[0].to_dict()
    return {
        "n_incidents": len(inc),
        "n_impacted_trains": len(pd.read_csv(config.IMPACT_CSV)),
        "period_from": str(config.GEN_START_DATE.date()),
        "period_to": str((config.GEN_START_DATE + timedelta(days=config.GEN_DAYS_SPAN - 1)).date()),
        "first_start": inc.start_time.min(), "last_start": inc.start_time.max(),
        "seed": config.RANDOM_SEED,
        "type_weights": generate_data.TYPE_WEIGHTS,
        "weather_weights": generate_data.WEATHER_WEIGHTS,
        "time_buckets": {k: {"from_h": a, "to_h": b % 24, "weight": w}
                         for k, (a, b, w) in generate_data.TIME_BUCKETS.items()},
        "rules": [{"name": n, "factor": f, "when": w, "why": y, "name_fr": nf, "why_fr": yf}
                  for (n, f, w, y), (nf, yf) in zip(GENERATOR_RULES, GENERATOR_RULES_FR)],
        "network": pd.read_csv(config.NETWORK_CSV).to_dict("records"),
        "by_type": by_type,
        "example_incident": {k: (int(v) if hasattr(v, "item") else v) for k, v in example.items()},
        "example_training_row": {k: (v.item() if hasattr(v, "item") else v) for k, v in train.iloc[0].to_dict().items()},
    }


def build() -> dict:
    rulebook = baseline.load_rulebook()
    X_test, y_test = evaluate.load_test_set()
    preds = evaluate.evaluate_models(X_test, y_test, verbose=False)
    passengers = evaluate.passenger_satisfaction_sim(y_test, preds, verbose=False)
    routes = json.loads(simulation.ROUTES_JSON.read_text(encoding="utf-8"))
    return {
        "timetable": {
            "source": routes["source"],
            "days": [{"date": d["date"], "day_type": d["day_type"],
                      "itineraries": [{"id": i["id"], "label": i["label"], "line_name": i["line_name"],
                                       "track_layout": i["track_layout"], "track_note": i["track_note"],
                                       "label_fr": i["label_fr"], "line_name_fr": i["line_name_fr"],
                                       "track_note_fr": i["track_note_fr"],
                                       "sources": i["sources"], "n_trains": len(i["trains"]),
                                       "n_connections": len(i.get("connection", {}).get("trains", []))}
                                      for i in d["itineraries"]]} for d in routes["days"]],
            "big_city_stations": routes["big_city_stations"],
        },
        "assumptions": {
            "urban_radius_km": simulation.URBAN_RADIUS_KM,
            "depot_radius_km": simulation.DEPOT_RADIUS_KM,
            "booking_min_transfer": simulation.BOOKING_MIN_TRANSFER,
            "transfer_walk_min": simulation.TRANSFER_WALK_MIN,
            "rebook_below": simulation.REBOOK_BELOW,
        },
        "rulebook": [{"type_id": t, **{k: r[k] for k in ("label", "category", "tracks_blocked", "dur_min",
                                                          "dur_median", "dur_max", "evidence", "source_url",
                                                          "source_note", "label_fr", "source_note_fr")}}
                     for t, r in rulebook.items()],
        "training": training_summary(),
        "features": [{"name": f, "kind": "category" if f in config.CATEGORICAL_FEATURES else "number",
                      "description": FEATURE_DESCRIPTIONS[f], "description_fr": FEATURE_DESCRIPTIONS_FR[f]}
                     for f in config.CATEGORICAL_FEATURES + config.NUMERIC_FEATURES],
        "model": {
            "algorithm": "GradientBoostingRegressor (scikit-learn), loss = quantile",
            "quantiles": config.QUANTILES,
            "split": "80% training / 20% test, random_state = 42",
            "n_test": preds["metrics"]["n_test"],
            "n_train": len(pd.read_csv(config.TRAINING_CSV)) - preds["metrics"]["n_test"],
        },
        "metrics": preds["metrics"],
        "passenger_sim": {
            "results": {k: {**v, "label_fr": PASSENGER_LABELS_FR[k]} for k, v in passengers.items()},
            "miss_cost": evaluate.MISS_COST, "rebook_cost": evaluate.REBOOK_COST,
            "stay_if_prob": evaluate.STAY_IF_PROB,
        },
        "real_world": REAL_WORLD_SNAPSHOT,
        "llm": {"provider": "Groq (free plan)", "model": config.LLM_MODEL, "base_url": config.LLM_BASE_URL},
    }


if __name__ == "__main__":
    r = build()
    m = r["metrics"]
    print(f"Timetable: {r['timetable']['source']['feed_version']} "
          f"({r['timetable']['source']['valid_from']} -> {r['timetable']['source']['valid_to']})")
    print(f"Training: {r['training']['n_incidents']} synthetic incidents, "
          f"{r['training']['period_from']} -> {r['training']['period_to']}")
    print(f"MAE  baseline {m['baseline']['mae']:.1f}  model {m['model']['mae']:.1f}")
    print(f"Coverage baseline {m['baseline']['coverage']:.0%}  model {m['model']['coverage']:.0%}")
    for k, v in r["passenger_sim"]["results"].items():
        print(f"  {v['label']}: missed {v['missed_rate']:.0%}, cost {v['avg_cost']:.1f}")
