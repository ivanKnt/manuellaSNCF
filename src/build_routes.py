"""
Phase 5a - Build the simulation's itineraries from the REAL SNCF timetable.

Input : the official SNCF GTFS timetable (TGV, Intercités, TER), published on
        transport.data.gouv.fr. Downloaded into data/raw/gtfs/ if missing.
Output: data/routes.json      every real train of our itineraries, for two
                              reference days (a weekday and a Saturday)
        docs/ITINERARIES.md   the same list, readable by a human

What comes from the timetable (real): train numbers, brands, stops, times,
station coordinates, the connecting TER trains.
What we add by hand (with a source for each): track layout of each line,
and which cities count as "big" (used to place an incident in a town or in
the countryside).

Run:  python3 src/build_routes.py
"""
from __future__ import annotations

import io
import json
import urllib.request
import zipfile
from datetime import date, datetime

import pandas as pd

import config

GTFS_URL = "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip"
GTFS_PAGE = "https://transport.data.gouv.fr/datasets/horaires-sncf"
GTFS_DIR = config.DATA_DIR / "raw" / "gtfs"
ROUTES_JSON = config.DATA_DIR / "routes.json"
ITINERARIES_MD = config.PROJECT_ROOT / "docs" / "ITINERARIES.md"

REFERENCE_DAYS = {"2026-12-08": "weekday", "2026-12-12": "weekend"}  # a Tuesday, a Saturday

# Stations are identified by their UIC code: the 8-digit number every station
# in Europe has (e.g. 87686006 = Paris Gare de Lyon).
BIG_CITY_STATIONS = {  # stations inside a city of more than 100,000 inhabitants
    "87686006": "Paris", "87271007": "Paris", "87723197": "Lyon",
    "87747006": "Grenoble", "87286005": "Lille", "87223263": "Lille",
}

BRAND_NAMES = {"Train TER": "TER"}

WIKI = "https://fr.wikipedia.org/wiki/"
ITINERARIES = [
    {
        "id": "paris-lyon",
        "label": "Paris → Lyon (high-speed TGV)",
        "label_fr": "Paris → Lyon (TGV, grande vitesse)",
        "origin": "87686006", "destination": "87723197",
        "brands": ["TGV INOUI", "OUIGO"],
        "line_type": "TGV",
        "line_name": "LGV Sud-Est (high-speed line), 409 km",
        "line_name_fr": "LGV Sud-Est (ligne à grande vitesse), 409 km",
        "track_layout": "double",
        "track_note": "Double track over the whole high-speed line.",
        "track_note_fr": "Double voie sur toute la ligne à grande vitesse.",
        "sources": [{"title": "LGV Sud-Est - Wikipedia (infobox: 'Nombre de voies: Double voie')",
                     "url": WIKI + "LGV_Sud-Est"}],
        "connection": {"station": "87723197", "to": "87747006", "label": "Grenoble",
                       "line_name": "Lyon - Grenoble (double track)"},
    },
    {
        "id": "grenoble-gap",
        "label": "Grenoble → Gap (mountain TER, single track)",
        "label_fr": "Grenoble → Gap (TER de montagne, voie unique)",
        "origin": "87747006", "destination": "87763003",
        "brands": ["Train TER"],
        "line_type": "TER",
        "line_name": "Ligne des Alpes (Grenoble - Veynes), then Veynes - Briançon line",
        "line_name_fr": "Ligne des Alpes (Grenoble - Veynes), puis ligne Veynes - Briançon",
        "track_layout": "single",
        "track_note": ("Single track for almost 100 km after Grenoble, back to double only for the last "
                       "few km before Veynes; single track again from Veynes to Gap."),
        "track_note_fr": ("Voie unique sur près de 100 km après Grenoble, double voie seulement sur les "
                          "derniers kilomètres avant Veynes, puis de nouveau voie unique de Veynes à Gap."),
        "double_track_legs": [["Aspres-sur-Buëch", "Veynes Dévoluy"]],
        "sources": [
            {"title": "Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) - Wikipedia, "
                      "section 'Tracé' (citing SNCF technical documents RT 5076)",
             "url": WIKI + "Ligne_de_Lyon-Perrache_%C3%A0_Marseille-Saint-Charles_(via_Grenoble)"},
            {"title": "Ligne de Veynes à Briançon - Wikipedia ('Veynes - Gap : voie unique')",
             "url": WIKI + "Ligne_de_Veynes_%C3%A0_Brian%C3%A7on"},
        ],
    },
    {
        "id": "paris-lille",
        "label": "Paris → Lille (high-speed TGV)",
        "label_fr": "Paris → Lille (TGV, grande vitesse)",
        "origin": "87271007", "destination": "87286005",
        "brands": ["TGV INOUI", "OUIGO"],
        "line_type": "TGV",
        "line_name": "LGV Nord (high-speed line), 323 km",
        "line_name_fr": "LGV Nord (ligne à grande vitesse), 323 km",
        "track_layout": "double",
        "track_note": "Double track over the whole high-speed line.",
        "track_note_fr": "Double voie sur toute la ligne à grande vitesse.",
        "sources": [{"title": "LGV Nord - Wikipedia (infobox: 'Nombre de voies: Double voie')",
                     "url": WIKI + "LGV_Nord"}],
    },
]


# --- Loading the timetable ---------------------------------------------------
def ensure_gtfs() -> None:
    if (GTFS_DIR / "stop_times.txt").exists():
        return
    print(f"Downloading the SNCF timetable from {GTFS_URL} ...")
    with urllib.request.urlopen(GTFS_URL, timeout=120) as resp:
        zipfile.ZipFile(io.BytesIO(resp.read())).extractall(GTFS_DIR)


def load_gtfs():
    feed = pd.read_csv(GTFS_DIR / "feed_info.txt", dtype=str).iloc[0]
    stops = pd.read_csv(GTFS_DIR / "stops.txt", dtype=str)
    stops = stops[stops.location_type == "1"].copy()
    stops["uic"] = stops.stop_id.str[-8:]
    trips = pd.read_csv(GTFS_DIR / "trips.txt", dtype=str)
    calendar = pd.read_csv(GTFS_DIR / "calendar_dates.txt", dtype=str)
    stop_times = pd.read_csv(GTFS_DIR / "stop_times.txt", dtype=str,
                             usecols=["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"])
    # stop_id looks like "StopPoint:OCETGV INOUI-87686006": brand, then the UIC code.
    stop_times["uic"] = stop_times.stop_id.str[-8:]
    stop_times["brand"] = stop_times.stop_id.str.extract(r"OCE(.+)-\d{8}$")[0]
    stop_times["seq"] = stop_times.stop_sequence.astype(int)
    return feed, stops, trips, calendar, stop_times


def gtfs_minutes(hhmmss: str) -> int:
    """GTFS times can pass 24:00 for trains running after midnight."""
    h, m, _ = (int(x) for x in hhmmss.split(":"))
    return h * 60 + m


def fmt(minutes: int) -> str:
    return f"{minutes // 60 % 24:02d}:{minutes % 60:02d}"


# --- Extraction --------------------------------------------------------------
def trains_between(st_day, trips_day, origin, destination, brands=None):
    """Every train of the day that stops at `origin` and later at `destination`."""
    a = st_day[st_day.uic == origin][["trip_id", "seq"]]
    b = st_day[st_day.uic == destination][["trip_id", "seq"]]
    pairs = a.merge(b, on="trip_id", suffixes=("_a", "_b"))
    pairs = pairs[pairs.seq_a < pairs.seq_b]
    out = []
    for _, p in pairs.iterrows():
        rows = st_day[(st_day.trip_id == p.trip_id) & st_day.seq.between(p.seq_a, p.seq_b)].sort_values("seq")
        brand = rows.brand.iloc[0]
        if brands and brand not in brands:
            continue
        number = trips_day.loc[trips_day.trip_id == p.trip_id, "trip_headsign"].iloc[0]
        out.append({"number": number, "brand": brand, "rows": rows})
    return sorted(out, key=lambda t: gtfs_minutes(t["rows"].departure_time.iloc[0]))


def build_day(day: str, day_type: str, stops, trips, calendar, stop_times) -> dict:
    services = set(calendar[(calendar.date == day.replace("-", "")) & (calendar.exception_type == "1")].service_id)
    trips_day = trips[trips.service_id.isin(services)]
    st_day = stop_times[stop_times.trip_id.isin(set(trips_day.trip_id))]
    names = dict(zip(stops.uic, stops.stop_name))
    coords = {u: (float(la), float(lo)) for u, la, lo in zip(stops.uic, stops.stop_lat, stops.stop_lon)}

    def stop_dict(r):
        lat, lon = coords[r.uic]
        return {"uic": r.uic, "name": names[r.uic], "lat": lat, "lon": lon,
                "arrival": fmt(gtfs_minutes(r.arrival_time)), "departure": fmt(gtfs_minutes(r.departure_time)),
                "arrival_min": gtfs_minutes(r.arrival_time), "departure_min": gtfs_minutes(r.departure_time)}

    itineraries = []
    for it in ITINERARIES:
        trains = trains_between(st_day, trips_day, it["origin"], it["destination"], it["brands"])
        entry = {k: v for k, v in it.items() if k not in ("brands", "connection", "double_track_legs")}
        entry["trains"] = []
        for t in trains:
            stops_list = [stop_dict(r) for r in t["rows"].itertuples()]
            legs = []
            for a, b in zip(stops_list, stops_list[1:]):
                double = [a["name"], b["name"]] in it.get("double_track_legs", [])
                legs.append({"track_layout": "double" if double else it["track_layout"]})
            brand = BRAND_NAMES.get(t["brand"], t["brand"])
            entry["trains"].append({"id": f"{brand} {t['number']}", "number": t["number"], "brand": brand,
                                    "stops": stops_list, "legs": legs})
        if "connection" in it:
            c = it["connection"]
            connecting = trains_between(st_day, trips_day, c["station"], c["to"], ["Train TER"])
            entry["connection"] = {
                **c, "station_name": names[c["station"]], "to_name": names[c["to"]],
                "trains": [{"id": f"TER {t['number']}",
                            "departure": fmt(gtfs_minutes(t["rows"].departure_time.iloc[0])),
                            "departure_min": gtfs_minutes(t["rows"].departure_time.iloc[0]),
                            "arrival": fmt(gtfs_minutes(t["rows"].arrival_time.iloc[-1]))} for t in connecting],
            }
        itineraries.append(entry)
    return {"date": day, "day_type": day_type, "itineraries": itineraries}


# --- Human-readable list -----------------------------------------------------
def write_markdown(result: dict) -> None:
    src = result["source"]
    lines = [
        "# Itineraries used by the simulation",
        "",
        "Generated by `python3 src/build_routes.py`. Do not edit by hand.",
        "",
        "## Where the timetable comes from",
        "",
        f"- Publisher: {src['publisher']} (official open data)",
        f"- Dataset: SNCF timetable (TGV, Intercités, TER) in GTFS format, [{src['page']}]({src['page']})",
        f"- File: `{src['url']}`",
        f"- Feed version: {src['feed_version']}, valid from {src['valid_from']} to {src['valid_to']}",
        f"- Published on: {src['published_on']}",
        f"- Reference days used: " + ", ".join(f"{d['date']} ({d['day_type']})" for d in result["days"]),
        "",
        "## What we added by hand",
        "",
        "- Track layout of each line (single or double track), with the source listed under each itinerary.",
        "- \"Big city\" stations (city above 100,000 inhabitants): "
        + ", ".join(sorted({f"{v}" for v in BIG_CITY_STATIONS.values()})) + ". "
        "An incident within 10 km of one counts as *urban*; within 25 km as *near a maintenance base* (assumption).",
        "",
    ]
    for day in result["days"]:
        lines += [f"## {day['date']} ({day['day_type']})", ""]
        for it in day["itineraries"]:
            lines += [f"### {it['label']}", "",
                      f"- Line: {it['line_name']}", f"- Track: **{it['track_layout']}**. {it['track_note']}"]
            lines += [f"- Source: [{s['title']}]({s['url']})" for s in it["sources"]]
            doubles = [" → ".join(p) for p in next(
                (i.get("double_track_legs", []) for i in ITINERARIES if i["id"] == it["id"]), [])]
            if doubles:
                lines.append(f"- Exception, double track: {', '.join(doubles)}")
            lines += ["", f"{len(it['trains'])} trains:", "", "| Train | Departure | Arrival | Stops (arrival time) |",
                      "|---|---|---|---|"]
            for t in it["trains"]:
                s = t["stops"]
                middle = ", ".join(f"{x['name']} {x['arrival']}" for x in s[1:-1]) or "nonstop"
                lines.append(f"| {t['id']} | {s[0]['departure']} {s[0]['name']} | {s[-1]['arrival']} {s[-1]['name']} | {middle} |")
            if "connection" in it:
                c = it["connection"]
                lines += ["", f"Connecting trains {c['station_name']} → {c['to_name']} ({c['line_name']}):", "",
                          ", ".join(f"{t['id']} {t['departure']}" for t in c["trains"])]
            lines.append("")
    ITINERARIES_MD.parent.mkdir(exist_ok=True)
    ITINERARIES_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    ensure_gtfs()
    feed, stops, trips, calendar, stop_times = load_gtfs()
    result = {
        "source": {
            "publisher": feed.feed_publisher_name, "page": GTFS_PAGE, "url": GTFS_URL,
            "feed_version": feed.feed_version,
            "valid_from": str(datetime.strptime(feed.feed_start_date, "%Y%m%d").date()),
            "valid_to": str(datetime.strptime(feed.feed_end_date, "%Y%m%d").date()),
            "published_on": str(date.fromtimestamp((GTFS_DIR / "feed_info.txt").stat().st_mtime)),
        },
        "big_city_stations": BIG_CITY_STATIONS,
        "days": [build_day(d, t, stops, trips, calendar, stop_times) for d, t in REFERENCE_DAYS.items()],
    }
    ROUTES_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    write_markdown(result)
    for day in result["days"]:
        for it in day["itineraries"]:
            n_conn = len(it.get("connection", {}).get("trains", []))
            print(f"{day['date']} {it['id']:<13} {len(it['trains']):>3} trains"
                  + (f", {n_conn} connecting TER" if n_conn else ""))
    print(f"Wrote {ROUTES_JSON} and {ITINERARIES_MD}")


if __name__ == "__main__":
    main()
