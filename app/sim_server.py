"""
Interactive passenger simulation - web server.

A thin layer: the browser (app/sim/) animates and keeps the clock, and calls
these endpoints for every number. All logic lives in src/simulation.py, and
the report's numbers in src/report.py.

Run:  python3 app/sim_server.py     then open http://localhost:8000
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from typing import Literal  # noqa: E402

from pydantic import BaseModel  # noqa: E402

import config  # noqa: E402
import narrator  # noqa: E402
import report  # noqa: E402
import simulation  # noqa: E402

app = FastAPI(title="SNCF passenger simulation")
sim = simulation.Simulator()
REPORT = report.build()  # computed once at startup (about 3 seconds)
Lang = Literal["en", "fr"]


class JourneyRequest(BaseModel):
    date: str
    itinerary_id: str
    train_id: str
    origin: str
    destination: str
    weather: str = "random"
    with_connection: bool = False
    lang: Lang = "en"


class IncidentRequest(BaseModel):
    journey: dict
    leg_index: int
    leg_fraction: float = 0.5
    sim_time: str
    type_id: str | None = None
    prior_delay_min: float = 0
    lang: Lang = "en"


class UpdateRequest(BaseModel):
    journey: dict
    incident: dict
    elapsed_min: float
    prior_delay_min: float
    sim_time: str
    lang: Lang = "en"


class ResolveRequest(BaseModel):
    journey: dict
    incident: dict
    total_delay_min: float
    sim_time: str
    lang: Lang = "en"


class ChatRequest(BaseModel):
    question: str
    facts: dict
    lang: Lang = "en"


@app.get("/api/options")
def options():
    return {**sim.options(),
            "assistant": "groq" if os.environ.get(config.LLM_API_KEY_ENV) else "offline"}


@app.get("/api/report")
def get_report():
    return REPORT


@app.post("/api/journey")
def journey(req: JourneyRequest):
    try:
        return sim.plan_journey(req.date, req.itinerary_id, req.train_id, req.origin, req.destination,
                                req.weather, req.with_connection, req.lang)
    except (KeyError, ValueError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.post("/api/incident")
def incident(req: IncidentRequest):
    return sim.start_incident(req.journey, req.leg_index, req.sim_time, req.type_id,
                              req.prior_delay_min, req.leg_fraction, req.lang)


@app.post("/api/incident/update")
def incident_update(req: UpdateRequest):
    return sim.update_incident(req.journey, req.incident, req.elapsed_min, req.prior_delay_min, req.sim_time,
                               req.lang)


@app.post("/api/incident/resolve")
def incident_resolve(req: ResolveRequest):
    return sim.resolve_incident(req.journey, req.incident, req.total_delay_min, req.sim_time, req.lang)


@app.post("/api/chat")
def chat(req: ChatRequest):
    return {"answer": narrator.answer_question(req.question, req.facts, req.lang)}


# Mounted last so the /api routes above take priority.
app.mount("/", StaticFiles(directory=ROOT / "app" / "sim", html=True), name="sim")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
