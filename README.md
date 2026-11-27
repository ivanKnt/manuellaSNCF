# Manuella — SNCF Disruption Recovery Estimator

When a train journey is disrupted (animal on the track, broken rail, person on
the line…), SNCF often goes **silent** about *how much longer* it will take.
This project estimates that recovery time as an **honest range** (e.g. "20–35
more minutes") and communicates it clearly — because for passengers,
**uncertainty is worse than delay**.

> The product is not a chatbot. The product is **trust during uncertainty**.
> The model computes; the language model only narrates.

## Why synthetic data

No public SNCF dataset logs `incident → how long it took to clear`. So we
**generate** one, calibrated to real published SNCF figures where they exist
(person on the track ~2 h 30, abandoned baggage ~19 min, broken rail 2–3 h).
The other durations are our own estimates, and are labelled as such in
`data/incident_types.csv` (columns `evidence`, `source_url`, `source_note`).

What is **real**: the trains, stops and times (official SNCF GTFS timetable,
version 2026-11-26), the track layouts (Wikipedia) and the published SNCF figures.
What is **estimated**: durations SNCF does not publish, and our thresholds.
What is **synthetic**: the incident log the model learns from.
The full explanation, with sources, is inside the simulation ("Report: how it works").

## Project structure

```
data/
  raw/gtfs/            # official SNCF timetable (downloaded, not committed)
  routes.json          # GENERATED real trains for the simulation (from the GTFS)
  incident_types.csv   # rulebook: durations per incident type + evidence + source
  network.csv          # the map: lines/segments (single vs double track, TGV/TER)
  incidents.csv        # GENERATED event log + label (resolution_minutes)
  impact.csv           # GENERATED cascade: one incident -> many delayed trains
  training_data.csv    # GENERATED flat table the model learns from
src/
  config.py            # paths, feature lists, tuning knobs
  generate_data.py     # Phase 0 - builds the synthetic dataset (WORKING)
  baseline.py          # Phase 1a - non-ML lookup baseline
  train.py             # Phase 1b - fit quantile models (the RANGE)
  predict.py           # Phase 1c - predict low/median/high for a new incident
  impact_engine.py     # Phase 2 - arrival range + connection probability + cascade
  narrator.py          # Phase 3 - LLM phrases the numbers (never invents them)
  gtfs_rt_client.py    # optional - pull the real live SNCF feed
  evaluate.py          # Phase 4 - model metrics + passenger-satisfaction sim
  build_routes.py      # Phase 5 - real itineraries from the SNCF GTFS timetable
  simulation.py        # Phase 5 - journey + incident engine for the live simulation
  report.py            # Phase 5 - every number, source and metric behind the in-app report
docs/
  ITINERARIES.md       # GENERATED list of every train, stop and time used (for the professor)
app/
  demo.py              # Streamlit demo (fake phone: push + chatbot)
  sim_server.py        # Phase 5 - web server for the interactive passenger simulation
  sim/                 # its browser side (HTML/CSS/JS: animation, clock, phone)
tests/
  test_generate_data.py
```

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Optional, for the chatbot: create a free key at [console.groq.com/keys](https://console.groq.com/keys),
copy `.env.example` to `.env`, and paste the key after `GROQ_API_KEY=`.
Without a key, the chatbot falls back to the computed facts (no error).

## Usage

```bash
python3 src/generate_data.py     # (re)generate the dataset
python3 -m pytest                # sanity-check the data
python3 src/train.py             # train the quantile models
python3 src/evaluate.py          # model vs baseline + passenger simulation
python3 src/narrator.py          # push message + chatbot example
streamlit run app/demo.py        # the demo: phone screen + chat
python3 src/build_routes.py      # download the SNCF timetable, write routes.json + docs/ITINERARIES.md
python3 src/report.py            # print the data behind the in-app report
python3 app/sim_server.py        # interactive passenger simulation -> http://localhost:8000
```

## Deploy on Netlify by dropping a folder

Drop **`app/sim`**, not the whole project. Netlify publishes exactly the folder you drop, and the page (`index.html`) is inside `app/sim`. Dropping the whole project would also upload your `.env` key.

The folder is ready: `bundle.json` is already in it (the three models, the timetable and the report). On the dropped site the simulation runs in the browser. The assistant answers from the computed facts. The live Groq chatbot needs a linked repository instead of a drop, because a drop cannot run the function that holds the key.

1. Open [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the folder `app/sim` onto the page.
3. Netlify gives you a URL. Open it.

If you change the models later, run `python3 src/export_netlify.py` and drop `app/sim` again.

## Roadmap

- [x] Phase 0 — synthetic data generator
- [x] Phase 1 — baseline + quantile model (the range)
- [x] Phase 2 — journey impact engine (arrival + connections)
- [x] Phase 3 — LLM narrator (grounded push + chatbot, free Groq plan)
- [x] Phase 4 — evaluation: silence vs point ETA vs range+confidence
- [x] Phase 5 — interactive passenger simulation (boarding, live incidents, updates)
