"""Netlify function: the passenger's question, answered only from the facts.

The Groq key is a site environment variable (GROQ_API_KEY), never in the page.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

BASE_URL = "https://api.groq.com/openai/v1"
MODEL = "openai/gpt-oss-20b"

PROMPT = """You are the SNCF disruption assistant. Answer the passenger using ONLY the facts below.
Rules:
- Never invent or change a number, time, station or probability. If the facts don't contain the answer, say you don't know yet.
- Always give the delay as a range, never as one exact time.
- Write times exactly as they appear in the facts (HH:MM, for example 21:16).
- At most 3 short sentences. Calm and honest. Reply in {language}, whatever language the facts are written in.
Facts (JSON):
{facts}"""

FALLBACK = {
    "en": "Here is what we know right now: {summary}",
    "fr": "Voici ce que nous savons pour l'instant : {summary}",
}
LANGUAGES = {"en": "English", "fr": "French"}


def _answer(question: str, facts: dict, lang: str) -> str:
    summary = facts.get("summary", "")
    fallback = FALLBACK.get(lang, FALLBACK["en"]).format(summary=summary)
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        return fallback
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": PROMPT.format(
                facts=json.dumps(facts, ensure_ascii=False), language=LANGUAGES.get(lang, "English"))},
            {"role": "user", "content": question},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
    }
    request = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "manuella-sncf-narrator/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.load(response)
        return data["choices"][0]["message"]["content"].strip()
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError):
        return fallback


def handler(event, context):
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        payload = {}
    lang = payload.get("lang") if payload.get("lang") in LANGUAGES else "fr"
    answer = _answer(payload.get("question") or "", payload.get("facts") or {}, lang)
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"answer": answer}, ensure_ascii=False),
    }
