"""
Phase 3 - The narrator (smallest box).

CRITICAL RULE: the model computes, the language model narrates. It NEVER
invents a number. It only rephrases facts produced by predict.py and
impact_engine.py.

  - build_push_message(): a plain template, no language model needed.
  - answer_question():    the chatbot. Uses Groq if GROQ_API_KEY is set,
                          otherwise falls back to the facts we already have,
                          so the demo never shows an error.

Run:  python3 src/narrator.py
"""
from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime

import config

# python.org builds of Python on macOS don't use the system certificate store,
# so HTTPS fails with CERTIFICATE_VERIFY_FAILED. certifi ships a trusted bundle.
try:
    import certifi
    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CONTEXT = ssl.create_default_context()

SYSTEM_PROMPT = """You are the SNCF disruption assistant. Answer the passenger using ONLY the facts below.
Rules:
- Never invent or change a number, time, station or probability. If the facts don't contain the answer, say you don't know yet.
- Always give the delay as a range, never as one exact time.
- Write times exactly as they appear in the facts (HH:MM, for example 21:16).
- At most 3 short sentences. Calm and honest. Reply in {language}, whatever language the facts are written in.
Facts (JSON):
{facts}"""

LANGUAGES = {"en": "English", "fr": "French"}

PUSH_TEXT = {
    "en": {
        "clearance": "{label}. Expected clearance: {low}-{high} min (updating).",
        "arrival": "New arrival: {earliest}-{latest} (likely {expected}).",
        "connection": "Your {time} connection at {station}: {verdict} ({p}).",
        "verdicts": ("likely OK", "at risk", "unlikely, consider rebooking"),
        "fallback": "Here is what we know right now: {summary}",
    },
    "fr": {
        "clearance": "{label}. Reprise estimée dans {low} à {high} min (mise à jour en cours).",
        "arrival": "Nouvelle arrivée : {earliest}-{latest} (probablement {expected}).",
        "connection": "Votre correspondance de {time} à {station} : {verdict} ({p}).",
        "verdicts": ("probablement assurée", "menacée", "peu probable, pensez à changer de train"),
        "fallback": "Voici ce que nous savons pour l'instant : {summary}",
    },
}


def _hhmm(moment: datetime) -> str:
    return moment.strftime("%H:%M")


def _connection_verdict(probability: float, lang: str = "en") -> str:
    ok, risk, unlikely = PUSH_TEXT[lang]["verdicts"]
    if probability >= 0.8:
        return ok
    if probability >= 0.5:
        return risk
    return unlikely


def build_push_message(incident_label: str, prediction: dict, arrival_range: dict,
                       connection: dict | None = None, lang: str = "en") -> str:
    """Short, honest push notification built only from computed facts."""
    text = PUSH_TEXT[lang]
    parts = [
        text["clearance"].format(label=incident_label, low=prediction["low"], high=prediction["high"]),
        text["arrival"].format(earliest=_hhmm(arrival_range["earliest"]), latest=_hhmm(arrival_range["latest"]),
                               expected=_hhmm(arrival_range["expected"])),
    ]
    if connection:
        p = connection["probability"]
        parts.append(text["connection"].format(time=connection["time"], station=connection["station"],
                                               verdict=_connection_verdict(p, lang), p=f"{p:.0%}"))
    return " ".join(parts)


def build_facts(incident_label: str, prediction: dict, arrival_range: dict,
                connection: dict | None = None, lang: str = "en") -> dict:
    """The only information the language model is allowed to use."""
    facts = {
        "incident": incident_label,
        "clearance_minutes": {"low": prediction["low"], "likely": prediction["median"],
                              "high": prediction["high"]},
        "new_arrival": {"earliest": _hhmm(arrival_range["earliest"]),
                        "likely": _hhmm(arrival_range["expected"]),
                        "latest": _hhmm(arrival_range["latest"])},
        "summary": build_push_message(incident_label, prediction, arrival_range, connection, lang),
    }
    if connection:
        facts["connection"] = {"time": connection["time"], "station": connection["station"],
                               "chance_of_making_it": f"{connection['probability']:.0%}"}
    return facts


def answer_question(question: str, facts: dict, lang: str = "en") -> str:
    """Answer a passenger question, grounded only in `facts`."""
    api_key = os.environ.get(config.LLM_API_KEY_ENV)
    if not api_key:
        return _fallback_answer(facts, lang)
    try:
        return _ask_llm(api_key, question, facts, lang)
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError) as err:
        print(f"[narrator] language model unavailable ({err}); using fallback.", file=sys.stderr)
        return _fallback_answer(facts, lang)


def _ask_llm(api_key: str, question: str, facts: dict, lang: str = "en") -> str:
    prompt = SYSTEM_PROMPT.format(facts=json.dumps(facts, ensure_ascii=False), language=LANGUAGES[lang])
    body = {
        "model": config.LLM_MODEL,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": question},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
    }
    request = urllib.request.Request(
        f"{config.LLM_BASE_URL}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "manuella-sncf-narrator/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=20, context=_SSL_CONTEXT) as response:
        data = json.load(response)
    return data["choices"][0]["message"]["content"].strip()


def _fallback_answer(facts: dict, lang: str = "en") -> str:
    return PUSH_TEXT[lang]["fallback"].format(summary=facts["summary"])


if __name__ == "__main__":
    import impact_engine

    prediction = {"low": 57, "median": 84, "high": 149}
    scheduled = datetime(2026, 3, 2, 14, 0)
    arrival = impact_engine.new_arrival_range(scheduled, prediction)
    connection_departure = datetime(2026, 3, 2, 15, 45)
    connection = {
        "time": "15:45",
        "station": "Lyon Part-Dieu",
        "probability": impact_engine.connection_probability(scheduled, prediction,
                                                            connection_departure, walk_minutes=5),
    }
    label = "Animal on the track near Macon"

    print("PUSH:", build_push_message(label, prediction, arrival, connection))
    facts = build_facts(label, prediction, arrival, connection)
    mode = "Groq" if os.environ.get(config.LLM_API_KEY_ENV) else "fallback (no GROQ_API_KEY)"
    print(f"\nCHAT [{mode}]")
    question = "Will I make my 15:45 train in Lyon?"
    print("Q:", question)
    print("A:", answer_question(question, facts))
