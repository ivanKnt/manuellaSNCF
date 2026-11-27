"""
Demo UI (Streamlit) - a fake phone screen for the class presentation.

Pick an incident, a place and a journey; the app shows:
  - the push notification (range + connection chance)
  - what each information strategy would tell the passenger
  - a chat box grounded in the computed facts (Groq, or offline fallback)

Run:  streamlit run app/demo.py
"""
from __future__ import annotations

import csv
import os
import sys
from datetime import date, datetime, time
from pathlib import Path

# Make src/ importable when Streamlit runs from the project root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import streamlit as st  # noqa: E402

import baseline  # noqa: E402
import config  # noqa: E402
import impact_engine  # noqa: E402
import narrator  # noqa: E402
import predict  # noqa: E402

WEATHER = ["clear", "rain", "storm", "heat", "snow"]


@st.cache_resource
def load_models():
    return predict.load_models()


@st.cache_data
def load_tables():
    rulebook = baseline.load_rulebook()
    with open(config.NETWORK_CSV, newline="") as f:
        segments = list(csv.DictReader(f))
    return rulebook, segments


def time_bucket(moment: time) -> str:
    """Same hour windows as the data generator."""
    h = moment.hour
    if 6 <= h < 9:
        return "rush_am"
    if 9 <= h < 16:
        return "midday"
    if 16 <= h < 19:
        return "rush_pm"
    if 19 <= h < 23:
        return "evening"
    return "night"


def segment_label(seg: dict) -> str:
    return f"{seg['line_id']}: {seg['from_stop']} to {seg['to_stop']} ({seg['track_layout']} track)"


st.set_page_config(page_title="SNCF disruption assistant", layout="wide")
st.title("SNCF disruption assistant")
st.caption("When a train is disrupted, tell passengers how much longer it will take, honestly, as a range.")

rulebook, segments = load_tables()
try:
    models = load_models()
except FileNotFoundError:
    st.error("No trained model found. Run `python3 src/train.py` first, then reload this page.")
    st.stop()

# --- Scenario inputs --------------------------------------------------------
with st.sidebar:
    st.header("Incident")
    type_id = st.selectbox("What happened", list(rulebook), format_func=lambda t: rulebook[t]["label"])
    seg = st.selectbox("Where", segments, format_func=segment_label)
    weather = st.selectbox("Weather", WEATHER)
    incident_time = st.time_input("Incident started at", time(16, 40))
    day_type = st.radio("Day", ["weekday", "weekend"], horizontal=True)

    st.header("Passenger journey")
    scheduled_time = st.time_input("Scheduled arrival", time(17, 0))
    has_connection = st.toggle("Has a connection", value=True)
    connection_time = st.time_input("Connection departs", time(18, 0), disabled=not has_connection)
    connection_station = st.text_input("Connection station", "Lyon Part-Dieu", disabled=not has_connection)
    walk_minutes = st.slider("Walk to the connection (min)", 0, 20, 5, disabled=not has_connection)

itype = rulebook[type_id]
incident = {
    "type_id": type_id,
    "category": itype["category"],
    "tracks_blocked": itype["tracks_blocked"],
    "line_type": seg["line_type"],
    "track_layout": seg["track_layout"],
    "zone": seg["zone"],
    "near_depot": seg["near_depot"],
    "length_km": int(seg["length_km"]),
    "time_of_day": time_bucket(incident_time),
    "day_type": day_type,
    "weather": weather,
}

# --- The model computes -----------------------------------------------------
prediction = predict.predict(incident, models)
b_low, b_med, b_high = baseline.predict_range(type_id, rulebook)

today = date.today()
scheduled = datetime.combine(today, scheduled_time)
arrival = impact_engine.new_arrival_range(scheduled, prediction)

connection = None
if has_connection:
    probability = impact_engine.connection_probability(
        scheduled, prediction, datetime.combine(today, connection_time), walk_minutes)
    connection = {"time": connection_time.strftime("%H:%M"), "station": connection_station,
                  "probability": probability}

incident_label = f"{itype['label']} near {seg['from_stop']}"
push = narrator.build_push_message(incident_label, prediction, arrival, connection)
facts = narrator.build_facts(incident_label, prediction, arrival, connection)

# Reset the chat whenever the scenario changes, so answers always match the facts.
scenario = (type_id, seg["segment_id"], weather, incident_time, day_type,
            scheduled_time, has_connection, connection_time, connection_station, walk_minutes)
if st.session_state.get("scenario") != scenario:
    st.session_state.scenario = scenario
    st.session_state.messages = []

phone, details = st.columns([1, 1.3], gap="large")

# --- The passenger's phone --------------------------------------------------
with phone:
    st.subheader("Passenger's phone")
    with st.container(border=True):
        st.markdown("**SNCF Connect** · now")
        st.write(push)

    using_llm = bool(os.environ.get(config.LLM_API_KEY_ENV))
    st.caption(f"Chat: Groq ({config.LLM_MODEL})" if using_llm
               else "Chat: offline fallback. Add GROQ_API_KEY to .env for real answers.")

    chat_box = st.container(height=320)
    for message in st.session_state.messages:
        chat_box.chat_message(message["role"]).write(message["content"])

    question = st.chat_input("Ask about your journey")
    if question:
        st.session_state.messages.append({"role": "user", "content": question})
        chat_box.chat_message("user").write(question)
        with chat_box.chat_message("assistant"):
            with st.spinner("Thinking"):
                answer = narrator.answer_question(question, facts)
            st.write(answer)
        st.session_state.messages.append({"role": "assistant", "content": answer})

# --- Behind the scenes ------------------------------------------------------
with details:
    st.subheader("What each strategy tells the passenger")
    silence, point, ours = st.columns(3)
    with silence:
        st.markdown("**SNCF today**")
        st.info("Your train is delayed due to an incident.")
    with point:
        st.markdown("**Single estimate**")
        st.warning(f"Arriving around {arrival['expected']:%H:%M}.")
    with ours:
        st.markdown("**Our range**")
        text = f"Arriving {arrival['earliest']:%H:%M} to {arrival['latest']:%H:%M}."
        if connection:
            text += f" Connection: {connection['probability']:.0%} chance."
        st.success(text)

    st.subheader("Model vs baseline (clearance, minutes)")
    st.table({
        "": ["Baseline (type only)", "Model (all features)"],
        "low": [b_low, prediction["low"]],
        "likely": [b_med, prediction["median"]],
        "high": [b_high, prediction["high"]],
    })
    st.caption("The baseline only looks at the incident type. The model also uses track layout, "
               "weather, time of day, line type and location, so the same incident gets a "
               "different range in different conditions.")

    with st.expander("Facts sent to the language model"):
        st.json(facts)
