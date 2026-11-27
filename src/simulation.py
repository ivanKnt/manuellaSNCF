"""
Phase 5 - Passenger journey simulation engine.

The "brains" of the interactive simulation (served by app/sim_server.py, drawn
by app/sim/). The browser only animates and keeps the clock; every number the
passenger sees comes from here:

  plan_journey()     -> a REAL train from the SNCF timetable (data/routes.json)
  start_incident()   -> where the train is, the model's range, a hidden TRUE duration
  update_incident()  -> the estimate re-computed as time passes ("updating")
  resolve_incident() -> traffic resumes; we compare our estimate with the truth

The hidden true duration is drawn from the same process that generated the
training data, so each incident is a fair test of how honest the range is.
"""
from __future__ import annotations

import json
import math
import random
from datetime import date, datetime, timedelta

import baseline
import config
import generate_data
import impact_engine
import narrator
import predict

ROUTES_JSON = config.DATA_DIR / "routes.json"

# Assumptions (no public source): stated in the in-app report.
URBAN_RADIUS_KM = 10      # incident within 10 km of a big-city station -> "urban"
DEPOT_RADIUS_KM = 25      # within 25 km of one -> maintenance team "near"
BOOKING_MIN_TRANSFER = 15  # we book the first connection leaving >= 15 min after arrival
TRANSFER_WALK_MIN = 8      # minutes needed to change trains at the station
REBOOK_BELOW = 0.5         # suggest another connection below 50% chance

WINTER_MONTHS = {11, 12, 1, 2, 3}
SUMMER_MONTHS = {5, 6, 7, 8, 9}
WEATHER_DESCRIPTIONS = {
    "en": {"clear": "clear skies", "rain": "rain", "storm": "a storm with strong wind",
           "heat": "a heatwave", "snow": "snow"},
    "fr": {"clear": "ciel dégagé", "rain": "pluie", "storm": "tempête avec vent fort",
           "heat": "canicule", "snow": "neige"},
}

TEXT = {
    "en": {
        "welcome": "Welcome aboard {train} to {destination}. Scheduled arrival: {arrival}. "
                   "Weather along the route: {weather}, {temperature}°C.",
        "welcome_connection": " Your connection to {to} ({train}) leaves at {time}.",
        "incident_label": "{type} between {a} and {b}",
        "update": "Update {time}: ",
        "overrun": "this is taking longer than our estimate. ",
        "resumed": "{time}: traffic has resumed. The {type} lasted {true} min (our first estimate "
                   "was {low}-{high} min). New arrival: {arrival}.",
        "connection_ok": " You should make your {time} connection to {to}.",
        "connection_missed": " You will miss your {time} connection",
        "next_connection": "; the next one is {train} at {time}.",
        "no_connection": "; there is no later train to {to} today.",
        "suggestion": " Likely next connection: {train} at {time}.",
        "at": "{train} at {time}",
        "on_time": "on time", "delayed": "delayed by {minutes} min", "stopped": "stopped",
        "on_track": "on track", "will_be_missed": "will be missed",
        "bad_request": "Unknown day, itinerary or train.",
        "bad_order": "The destination must come after the origin on this train.",
    },
    "fr": {
        "welcome": "Bienvenue à bord du {train} à destination de {destination}. Arrivée prévue : {arrival}. "
                   "Météo sur le trajet : {weather}, {temperature} °C.",
        "welcome_connection": " Votre correspondance pour {to} ({train}) part à {time}.",
        "incident_label": "{type} entre {a} et {b}",
        "update": "Mise à jour {time} : ",
        "overrun": "l'incident dure plus longtemps que notre estimation. ",
        "resumed": "{time} : le trafic a repris. L'incident ({type}) a duré {true} min (notre première "
                   "estimation : {low} à {high} min). Nouvelle arrivée : {arrival}.",
        "connection_ok": " Vous devriez avoir votre correspondance de {time} pour {to}.",
        "connection_missed": " Vous allez manquer votre correspondance de {time}",
        "next_connection": " ; la suivante est le {train} à {time}.",
        "no_connection": " ; il n'y a plus de train pour {to} aujourd'hui.",
        "suggestion": " Prochaine correspondance possible : {train} à {time}.",
        "at": "{train} à {time}",
        "on_time": "à l'heure", "delayed": "en retard de {minutes} min", "stopped": "à l'arrêt",
        "on_track": "assurée", "will_be_missed": "sera manquée",
        "bad_request": "Jour, itinéraire ou train inconnu.",
        "bad_order": "La destination doit venir après le départ sur ce train.",
    },
}


def type_label(itype: dict, lang: str) -> str:
    return itype.get(f"label_{lang}") or itype["label"]
TEMPERATURES = {  # (winter range, other seasons range), flavour text only, not a model feature
    "clear": ((0, 9), (12, 26)), "rain": ((3, 10), (10, 18)), "storm": ((2, 9), (12, 22)),
    "heat": ((30, 36), (31, 38)), "snow": ((-6, 1), (-3, 2)),
}


def time_of_day_bucket(moment: datetime) -> str:
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


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Straight-line ("as the crow flies") distance between two GPS points."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _hhmm(moment: datetime) -> str:
    return moment.strftime("%H:%M")


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def seasonal_weather_odds(month: int) -> dict[str, int]:
    """The generator's weather odds, minus what cannot happen in this season."""
    odds = dict(generate_data.WEATHER_WEIGHTS)
    if month in WINTER_MONTHS:
        odds.pop("heat")
    elif month in SUMMER_MONTHS:
        odds.pop("snow")
    return odds


class Simulator:
    def __init__(self, seed: int | None = None) -> None:
        self.rng = random.Random(seed)
        self.models = predict.load_models()
        self.rulebook = baseline.load_rulebook()
        self.routes = json.loads(ROUTES_JSON.read_text(encoding="utf-8"))
        self.coords = {s["uic"]: (s["lat"], s["lon"])
                       for day in self.routes["days"] for it in day["itineraries"]
                       for t in it["trains"] for s in t["stops"]}
        self.big_cities = {uic: (city, self.coords[uic])
                           for uic, city in self.routes["big_city_stations"].items() if uic in self.coords}

    # --- Setup ---------------------------------------------------------------
    def options(self) -> dict:
        return {
            "source": self.routes["source"],
            "days": self.routes["days"],
            "incident_types": [{"type_id": t, "label": r["label"], "label_fr": r["label_fr"]}
                               for t, r in self.rulebook.items()],
            "weather": list(generate_data.WEATHER_WEIGHTS),
        }

    def _find(self, day: str, itinerary_id: str, train_id: str):
        d = next(x for x in self.routes["days"] if x["date"] == day)
        it = next(x for x in d["itineraries"] if x["id"] == itinerary_id)
        train = next(x for x in it["trains"] if x["id"] == train_id)
        return d, it, train

    def plan_journey(self, day: str, itinerary_id: str, train_id: str, origin: str, destination: str,
                     weather: str = "random", with_connection: bool = False, lang: str = "en") -> dict:
        text = TEXT[lang]
        try:
            d, it, train = self._find(day, itinerary_id, train_id)
        except StopIteration as err:
            raise ValueError(text["bad_request"]) from err
        uics = [s["uic"] for s in train["stops"]]
        i_from, i_to = uics.index(origin), uics.index(destination)
        if i_to <= i_from:
            raise ValueError(text["bad_order"])

        base_day = date.fromisoformat(day)
        midnight = datetime.combine(base_day, datetime.min.time())
        t0 = train["stops"][i_from]["departure_min"]
        stops = []
        for k, s in enumerate(train["stops"][i_from:i_to + 1]):
            minute = s["departure_min"] if k == 0 else s["arrival_min"]
            stops.append({"name": s["name"], "uic": s["uic"], "lat": s["lat"], "lon": s["lon"],
                          "offset_min": minute - t0,
                          "scheduled": (midnight + timedelta(minutes=minute)).isoformat()})
        legs = []
        for k in range(i_from, i_to):
            a, b = train["stops"][k], train["stops"][k + 1]
            legs.append({"from_stop": a["name"], "to_stop": b["name"], "from_uic": a["uic"], "to_uic": b["uic"],
                         "line_type": it["line_type"], "track_layout": train["legs"][k]["track_layout"],
                         "length_km": round(distance_km((a["lat"], a["lon"]), (b["lat"], b["lon"])), 1)})

        odds = seasonal_weather_odds(base_day.month)
        if weather == "random" or weather not in odds:
            weather = self.rng.choices(list(odds), weights=list(odds.values()))[0]
        winter_range, other_range = TEMPERATURES[weather]
        temperature = self.rng.randint(*(winter_range if base_day.month in WINTER_MONTHS else other_range))

        arrival = _parse(stops[-1]["scheduled"])
        arrival_min = train["stops"][i_to]["arrival_min"]
        connection = None
        offer = it.get("connection")
        if with_connection and offer and offer["station"] == destination:
            options = [c for c in offer["trains"] if c["departure_min"] >= arrival_min + BOOKING_MIN_TRANSFER]
            if options:
                booked = options[0]
                connection = {
                    "station": stops[-1]["name"], "to": offer["to_name"], "train": booked["id"],
                    "departure": (midnight + timedelta(minutes=booked["departure_min"])).isoformat(),
                    "walk_min": TRANSFER_WALK_MIN,
                    "alternatives": [{"train": c["id"],
                                      "departure": (midnight + timedelta(minutes=c["departure_min"])).isoformat()}
                                     for c in options[1:]],
                }

        journey = {
            "date": day, "itinerary_id": itinerary_id, "itinerary_label": it["label"],
            "line_name": it["line_name"], "track_note": it["track_note"], "track_sources": it["sources"],
            "train": train["id"], "origin": stops[0]["name"], "destination": stops[-1]["name"],
            "stops": stops, "legs": legs,
            "weather": weather, "weather_odds": odds, "temperature_c": temperature,
            "day_type": d["day_type"], "connection": connection,
        }
        welcome = text["welcome"].format(train=train["id"], destination=journey["destination"],
                                         arrival=_hhmm(arrival), weather=WEATHER_DESCRIPTIONS[lang][weather],
                                         temperature=temperature)
        if connection:
            welcome += text["welcome_connection"].format(to=connection["to"], train=connection["train"],
                                                         time=_hhmm(_parse(connection["departure"])))
        journey["welcome_message"] = welcome
        journey["facts"] = self._calm_facts(journey, delay_min=0, summary=welcome, lang=lang)
        return journey

    # --- Incidents -----------------------------------------------------------
    def locate(self, journey: dict, leg_index: int, leg_fraction: float) -> dict:
        """Where the train is: a point between two stations, and what is around it."""
        leg = journey["legs"][leg_index]
        f = min(max(leg_fraction, 0.0), 1.0)
        a, b = self.coords[leg["from_uic"]], self.coords[leg["to_uic"]]
        point = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        city, (uic, dist) = None, (None, float("inf"))
        for u, (name, xy) in self.big_cities.items():
            dd = distance_km(point, xy)
            if dd < dist:
                city, uic, dist = name, u, dd
        return {
            "lat": round(point[0], 5), "lon": round(point[1], 5),
            "km_after_from_stop": round(leg["length_km"] * f, 1),
            "nearest_big_city": city, "distance_to_big_city_km": round(dist, 1),
            "zone": "urban" if dist <= URBAN_RADIUS_KM else "rural",
            "near_depot": "yes" if dist <= DEPOT_RADIUS_KM else "no",
        }

    def start_incident(self, journey: dict, leg_index: int, sim_time: str, type_id: str | None = None,
                       prior_delay_min: float = 0, leg_fraction: float = 0.5, lang: str = "en") -> dict:
        if not type_id:
            type_id = self.rng.choices(list(generate_data.TYPE_WEIGHTS),
                                       weights=list(generate_data.TYPE_WEIGHTS.values()))[0]
        itype = self.rulebook[type_id]
        leg = journey["legs"][leg_index]
        where = self.locate(journey, leg_index, leg_fraction)
        tod = time_of_day_bucket(_parse(sim_time))

        features = {
            "type_id": type_id, "category": itype["category"],
            "tracks_blocked": itype["tracks_blocked"], "line_type": leg["line_type"],
            "track_layout": leg["track_layout"], "zone": where["zone"],
            "near_depot": where["near_depot"], "length_km": leg["length_km"],
            "time_of_day": tod, "day_type": journey["day_type"], "weather": journey["weather"],
        }
        context = {**leg, "zone": where["zone"], "near_depot": where["near_depot"]}
        lo, md, hi = baseline.predict_range(type_id, self.rulebook)
        incident = {
            "type_id": type_id,
            "short_label": type_label(itype, lang),
            "label": TEXT[lang]["incident_label"].format(type=type_label(itype, lang),
                                                         a=leg["from_stop"], b=leg["to_stop"]),
            "leg_index": leg_index,
            "features": features,
            "where": where,
            "rulebook": {"low": lo, "median": md, "high": hi, "evidence": itype["evidence"],
                         "source_url": itype["source_url"], "source_note": itype["source_note"]},
            "prediction": predict.predict(features, self.models),
            "true_minutes": self._sample_true_minutes(itype, context, journey["weather"], tod),
            "context_multiplier": round(generate_data.duration_multiplier(itype, context, journey["weather"], tod), 3),
            "started_at": sim_time,
        }
        status = self._incident_status(journey, incident, incident["prediction"],
                                       elapsed=0, prior_delay_min=prior_delay_min, lang=lang)
        return {"incident": incident, **status}

    def update_incident(self, journey: dict, incident: dict, elapsed_min: float,
                        prior_delay_min: float, sim_time: str, lang: str = "en") -> dict:
        text = TEXT[lang]
        remaining = impact_engine.remaining_range(incident["prediction"], elapsed_min)
        prefix = text["update"].format(time=_hhmm(_parse(sim_time)))
        if remaining["overrun"]:
            prefix += text["overrun"]
        return self._incident_status(journey, incident, remaining, elapsed_min, prior_delay_min, prefix, lang)

    def resolve_incident(self, journey: dict, incident: dict, total_delay_min: float, sim_time: str,
                         lang: str = "en") -> dict:
        text = TEXT[lang]
        first, true = incident["prediction"], incident["true_minutes"]
        new_arrival = _parse(journey["stops"][-1]["scheduled"]) + timedelta(minutes=total_delay_min)
        short = type_label(self.rulebook[incident["type_id"]], lang)
        message = text["resumed"].format(time=_hhmm(_parse(sim_time)), type=short.lower(), true=true,
                                         low=first["low"], high=first["high"], arrival=_hhmm(new_arrival))

        connection_made, rebooked = None, None
        c = journey["connection"]
        if c:
            departure = _parse(c["departure"])
            connection_made = new_arrival + timedelta(minutes=c["walk_min"]) <= departure
            if connection_made:
                message += text["connection_ok"].format(time=_hhmm(departure), to=c["to"])
            else:
                rebooked = self._next_reachable(c, new_arrival)
                message += text["connection_missed"].format(time=_hhmm(departure))
                message += (text["next_connection"].format(train=rebooked["train"],
                                                           time=_hhmm(_parse(rebooked["departure"])))
                            if rebooked else text["no_connection"].format(to=c["to"]))

        facts = self._calm_facts(journey, total_delay_min, message, lang=lang,
                                 extra={"last_incident": short, "last_incident_duration_min": true})
        return {
            "message": message,
            "estimate_was_right": first["low"] <= true <= first["high"],
            "connection_made": connection_made,
            "rebooked": rebooked,
            "arrival": new_arrival.isoformat(),
            "facts": facts,
        }

    # --- Helpers -------------------------------------------------------------
    @staticmethod
    def _next_reachable(connection: dict, arrival: datetime) -> dict | None:
        """First real connecting train the passenger can still catch."""
        for alt in connection["alternatives"]:
            if arrival + timedelta(minutes=connection["walk_min"]) <= _parse(alt["departure"]):
                return alt
        return None

    def _sample_true_minutes(self, itype: dict, context: dict, weather: str, tod: str) -> int:
        lo, mode, hi = float(itype["dur_min"]), float(itype["dur_median"]), float(itype["dur_max"])
        value = self.rng.triangular(lo, hi, mode) * generate_data.duration_multiplier(itype, context, weather, tod)
        return int(round(max(lo, min(value, hi * 1.5))))

    def _incident_status(self, journey: dict, incident: dict, remaining: dict,
                         elapsed: float, prior_delay_min: float, prefix: str = "", lang: str = "en") -> dict:
        text = TEXT[lang]
        scheduled = _parse(journey["stops"][-1]["scheduled"])
        label = self._incident_label(journey, incident, lang)
        total = {k: prior_delay_min + elapsed + remaining[k] for k in ("low", "median", "high")}
        arrival = impact_engine.new_arrival_range(scheduled, total)

        connection, probability, suggestion = None, None, None
        c = journey["connection"]
        if c:
            departure = _parse(c["departure"])
            probability = impact_engine.connection_probability(scheduled, total, departure, c["walk_min"])
            connection = {"time": _hhmm(departure), "station": c["station"], "probability": probability}

        message = prefix + narrator.build_push_message(label, remaining, arrival, connection, lang)
        if c and probability < REBOOK_BELOW:
            suggestion = self._next_reachable(c, arrival["expected"])
            if suggestion:
                message += text["suggestion"].format(train=suggestion["train"],
                                                     time=_hhmm(_parse(suggestion["departure"])))

        facts = narrator.build_facts(label, remaining, arrival, connection, lang)
        facts.update({
            "train": journey["train"], "destination": journey["destination"],
            "status": text["stopped"], "minutes_stopped_so_far": round(elapsed),
            "weather": f"{WEATHER_DESCRIPTIONS[lang][journey['weather']]}, {journey['temperature_c']}°C",
            "summary": message,
        })
        if suggestion:
            facts["suggested_connection"] = text["at"].format(train=suggestion["train"],
                                                              time=_hhmm(_parse(suggestion["departure"])))
        return {
            "remaining": remaining,
            "total_delay": total,
            "arrival": {k: v.isoformat() for k, v in arrival.items()},
            "connection_probability": probability,
            "suggestion": suggestion,
            "message": message,
            "facts": facts,
        }

    def _incident_label(self, journey: dict, incident: dict, lang: str) -> str:
        """The incident's name in the passenger's current language (they may switch mid-trip)."""
        if "leg_index" not in incident:
            return incident["label"]
        leg = journey["legs"][incident["leg_index"]]
        return TEXT[lang]["incident_label"].format(type=type_label(self.rulebook[incident["type_id"]], lang),
                                                   a=leg["from_stop"], b=leg["to_stop"])

    def _calm_facts(self, journey: dict, delay_min: float, summary: str, extra: dict | None = None,
                    lang: str = "en") -> dict:
        text = TEXT[lang]
        arrival = _parse(journey["stops"][-1]["scheduled"])
        facts = {
            "train": journey["train"], "destination": journey["destination"],
            "status": text["on_time"] if delay_min < 1 else text["delayed"].format(minutes=round(delay_min)),
            "scheduled_arrival": _hhmm(arrival),
            "estimated_arrival": _hhmm(arrival + timedelta(minutes=delay_min)),
            "weather": f"{WEATHER_DESCRIPTIONS[lang][journey['weather']]}, {journey['temperature_c']}°C",
            "summary": summary,
        }
        c = journey["connection"]
        if c:
            departure = _parse(c["departure"])
            reach = arrival + timedelta(minutes=delay_min + c["walk_min"])
            facts["connection"] = {"train": c["train"], "to": c["to"], "departs": _hhmm(departure),
                                   "status": text["on_track"] if reach <= departure else text["will_be_missed"]}
        if extra:
            facts.update(extra)
        return facts
