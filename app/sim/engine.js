// Browser copy of the simulation engine, used on Netlify.
// The Python server (app/sim_server.py) stays the local version. On Netlify
// there is no Python server, so this file answers the same /api calls from
// app/sim/bundle.json, which the build writes from the three trained models.
// Wrapped so its helpers do not collide with the other scripts on the page.

(function () {
const Engine = {
  bundle: null,

  async load() {
    if (!this.bundle) {
      const res = await fetch("bundle.json");
      if (!res.ok) throw new Error("bundle.json is missing. The Netlify build did not finish.");
      this.bundle = await res.json();
    }
    if (this.coords) return this.bundle;
    const coords = {};
    for (const day of this.bundle.routes.days) {
      for (const it of day.itineraries) {
        for (const train of it.trains) {
          for (const stop of train.stops) coords[stop.uic] = [stop.lat, stop.lon];
        }
      }
    }
    this.coords = coords;
    this.cities = Object.entries(this.bundle.routes.big_city_stations)
      .filter(([uic]) => coords[uic])
      .map(([uic, name]) => ({ uic, name, xy: coords[uic] }));
    return this.bundle;
  },

  async handle(path, body) {
    await this.load();
    if (path === "/api/options") return this.options();
    if (path === "/api/report") return this.bundle.report;
    if (path === "/api/journey") return this.planJourney(body);
    if (path === "/api/incident") return this.startIncident(body);
    if (path === "/api/incident/update") return this.updateIncident(body);
    if (path === "/api/incident/resolve") return this.resolveIncident(body);
    throw new Error(`Unknown route ${path}`);
  },

  options() {
    const b = this.bundle;
    return {
      source: b.routes.source,
      days: b.routes.days,
      incident_types: Object.entries(b.rulebook).map(([type_id, row]) => ({
        type_id, label: row.label, label_fr: row.label_fr,
      })),
      weather: Object.keys(b.weather_weights),
      assistant: "groq",
    };
  },

  planJourney(req) {
    const lang = req.lang === "en" ? "en" : "fr";
    const text = TEXT[lang];
    const day = this.bundle.routes.days.find((d) => d.date === req.date);
    const it = day && day.itineraries.find((i) => i.id === req.itinerary_id);
    const train = it && it.trains.find((t) => t.id === req.train_id);
    if (!train) throw new Error(text.bad_request);
    const uics = train.stops.map((s) => s.uic);
    const iFrom = uics.indexOf(req.origin);
    const iTo = uics.indexOf(req.destination);
    if (iTo <= iFrom) throw new Error(text.bad_order);

    const t0 = train.stops[iFrom].departure_min;
    const stops = train.stops.slice(iFrom, iTo + 1).map((s, k) => ({
      name: s.name, uic: s.uic, lat: s.lat, lon: s.lon,
      offset_min: (k === 0 ? s.departure_min : s.arrival_min) - t0,
      scheduled: iso(req.date, k === 0 ? s.departure_min : s.arrival_min),
    }));
    const legs = [];
    for (let k = iFrom; k < iTo; k += 1) {
      const a = train.stops[k];
      const b = train.stops[k + 1];
      legs.push({
        from_stop: a.name, to_stop: b.name, from_uic: a.uic, to_uic: b.uic,
        line_type: it.line_type, track_layout: train.legs[k].track_layout,
        length_km: round1(distance(a.lat, a.lon, b.lat, b.lon)),
      });
    }
    const month = Number(req.date.slice(5, 7));
    const odds = seasonalOdds(month, this.bundle.weather_weights);
    let weather = req.weather;
    if (!odds[weather]) weather = weightedChoice(odds);
    const winter = month === 11 || month === 12 || month <= 3;
    const span = TEMPERATURES[weather][winter ? 0 : 1];
    const temperature = randInt(span[0], span[1]);

    const arrivalMin = train.stops[iTo].arrival_min;
    let connection = null;
    const offer = it.connection;
    if (req.with_connection && offer && offer.station === req.destination) {
      const options = offer.trains.filter((c) => c.departure_min >= arrivalMin + 15);
      if (options.length) {
        const booked = options[0];
        connection = {
          station: stops[stops.length - 1].name, to: offer.to_name, train: booked.id,
          departure: iso(req.date, booked.departure_min), walk_min: 8,
          alternatives: options.slice(1).map((c) => ({ train: c.id, departure: iso(req.date, c.departure_min) })),
        };
      }
    }
    const arrival = stops[stops.length - 1].scheduled;
    let welcome = text.welcome
      .replace("{train}", train.id).replace("{destination}", stops[stops.length - 1].name)
      .replace("{arrival}", hhmm(arrival)).replace("{weather}", WEATHER[lang][weather])
      .replace("{temperature}", temperature);
    if (connection) {
      welcome += text.welcome_connection
        .replace("{to}", connection.to).replace("{train}", connection.train)
        .replace("{time}", hhmm(connection.departure));
    }
    const journey = {
      date: req.date, itinerary_id: it.id, itinerary_label: it.label,
      line_name: it.line_name, track_note: it.track_note, track_sources: it.sources,
      train: train.id, origin: stops[0].name, destination: stops[stops.length - 1].name,
      stops, legs, weather, weather_odds: odds, temperature_c: temperature,
      day_type: day.day_type, connection, welcome_message: welcome,
    };
    journey.facts = calmFacts(journey, 0, welcome, lang);
    return journey;
  },

  locate(journey, legIndex, fraction) {
    const leg = journey.legs[legIndex];
    const f = Math.min(1, Math.max(0, fraction));
    const a = this.coords[leg.from_uic];
    const b = this.coords[leg.to_uic];
    const point = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    let city = null;
    let dist = Infinity;
    for (const c of this.cities) {
      const dd = distance(point[0], point[1], c.xy[0], c.xy[1]);
      if (dd < dist) { city = c.name; dist = dd; }
    }
    const aRadius = this.bundle.assumptions.urban_radius_km;
    const dRadius = this.bundle.assumptions.depot_radius_km;
    return {
      lat: round5(point[0]), lon: round5(point[1]),
      km_after_from_stop: round1(leg.length_km * f),
      nearest_big_city: city, distance_to_big_city_km: round1(dist),
      zone: dist <= aRadius ? "urban" : "rural",
      near_depot: dist <= dRadius ? "yes" : "no",
    };
  },

  startIncident(req) {
    const lang = req.lang === "en" ? "en" : "fr";
    const book = this.bundle.rulebook;
    let typeId = req.type_id;
    if (!typeId) typeId = weightedChoice(this.bundle.type_weights);
    const itype = book[typeId];
    const leg = req.journey.legs[req.leg_index];
    const where = this.locate(req.journey, req.leg_index, req.leg_fraction ?? 0.5);
    const tod = timeOfDay(req.sim_time);
    const features = {
      type_id: typeId, category: itype.category, tracks_blocked: itype.tracks_blocked,
      line_type: leg.line_type, track_layout: leg.track_layout, zone: where.zone,
      near_depot: where.near_depot, length_km: leg.length_km, time_of_day: tod,
      day_type: req.journey.day_type, weather: req.journey.weather,
    };
    const name = lang === "fr" ? itype.label_fr : itype.label;
    const incident = {
      type_id: typeId, short_label: name,
      label: TEXT[lang].incident_label.replace("{type}", name).replace("{a}", leg.from_stop).replace("{b}", leg.to_stop),
      leg_index: req.leg_index, features, where,
      rulebook: {
        low: itype.dur_min, median: itype.dur_median, high: itype.dur_max,
        evidence: itype.evidence, source_url: itype.source_url, source_note: itype.source_note,
      },
      prediction: predict(this.bundle, features),
      true_minutes: sampleTrue(itype, { ...leg, zone: where.zone, near_depot: where.near_depot }, req.journey.weather, tod),
      context_multiplier: round3(multiplier(itype, { ...leg, zone: where.zone, near_depot: where.near_depot }, req.journey.weather, tod)),
      started_at: req.sim_time,
    };
    return { incident, ...incidentStatus(req.journey, incident, incident.prediction, 0, req.prior_delay_min || 0, "", lang) };
  },

  updateIncident(req) {
    const lang = req.lang === "en" ? "en" : "fr";
    const remaining = remainingRange(req.incident.prediction, req.elapsed_min);
    let prefix = TEXT[lang].update.replace("{time}", hhmm(req.sim_time));
    if (remaining.overrun) prefix += TEXT[lang].overrun;
    return incidentStatus(req.journey, req.incident, remaining, req.elapsed_min, req.prior_delay_min || 0, prefix, lang);
  },

  resolveIncident(req) {
    const lang = req.lang === "en" ? "en" : "fr";
    const text = TEXT[lang];
    const first = req.incident.prediction;
    const truth = req.incident.true_minutes;
    const arrival = addMinutes(req.journey.stops[req.journey.stops.length - 1].scheduled, req.total_delay_min);
    const itype = this.bundle.rulebook[req.incident.type_id];
    const short = (lang === "fr" ? itype.label_fr : itype.label).toLowerCase();
    let message = text.resumed
      .replace("{time}", hhmm(req.sim_time)).replace("{type}", short).replace("{true}", truth)
      .replace("{low}", first.low).replace("{high}", first.high).replace("{arrival}", hhmm(arrival));
    let connectionMade = null;
    let rebooked = null;
    const c = req.journey.connection;
    if (c) {
      connectionMade = addMinutes(arrival, c.walk_min) <= c.departure;
      if (connectionMade) message += text.connection_ok.replace("{time}", hhmm(c.departure)).replace("{to}", c.to);
      else {
        rebooked = nextReachable(c, arrival);
        message += text.connection_missed.replace("{time}", hhmm(c.departure));
        message += rebooked
          ? text.next_connection.replace("{train}", rebooked.train).replace("{time}", hhmm(rebooked.departure))
          : text.no_connection.replace("{to}", c.to);
      }
    }
    return {
      message, estimate_was_right: first.low <= truth && truth <= first.high,
      connection_made: connectionMade, rebooked, arrival,
      facts: calmFacts(req.journey, req.total_delay_min, message, lang, {
        last_incident: lang === "fr" ? itype.label_fr : itype.label,
        last_incident_duration_min: truth,
      }),
    };
  },
};

function predict(bundle, row) {
  const values = bundle.models.map((model) => boost(model, encode(bundle, model, row)));
  values.sort((a, b) => a - b);
  return { low: Math.round(values[0]), median: Math.round(values[1]), high: Math.round(values[2]) };
}

function encode(bundle, model, row) {
  const x = [];
  bundle.cat_names.forEach((name, i) => {
    model.categories[i].forEach((cat) => x.push(row[name] === cat ? 1 : 0));
  });
  bundle.num_names.forEach((name) => x.push(Number(row[name])));
  return x;
}

function boost(model, x) {
  let score = model.init;
  for (const tree of model.trees) score += model.learning_rate * walk(tree, x);
  return score;
}

function walk(tree, x) {
  let i = 0;
  while (tree.left[i] !== -1) {
    i = x[tree.feature[i]] <= tree.threshold[i] ? tree.left[i] : tree.right[i];
  }
  return tree.value[i];
}

function multiplier(itype, seg, weather, tod) {
  let m = 1;
  if (seg.track_layout === "single") m *= 1.2;
  if (seg.near_depot === "no") m *= 1.15;
  if (seg.zone === "rural") m *= 1.05;
  if ((weather === "storm" || weather === "snow") && (itype.category === "weather" || itype.category === "infrastructure")) m *= 1.25;
  if (itype.type_id === "person_accident" && seg.line_type === "TGV") m *= 1.2;
  if (tod === "rush_am" || tod === "rush_pm") m *= 1.08;
  return m;
}

function sampleTrue(itype, seg, weather, tod) {
  const lo = itype.dur_min;
  const hi = itype.dur_max;
  const value = triangular(lo, hi, itype.dur_median) * multiplier(itype, seg, weather, tod);
  return Math.round(Math.max(lo, Math.min(value, hi * 1.5)));
}

function triangular(lo, hi, mode) {
  const u = Math.random();
  const f = (mode - lo) / (hi - lo);
  if (u < f) return lo + Math.sqrt(u * (hi - lo) * (mode - lo));
  return hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
}

function knots(r) {
  const lo = r.low;
  const md = r.median;
  const hi = r.high;
  return [[Math.max(0, lo - 0.25 * (md - lo)), 0], [lo, 0.1], [md, 0.5], [hi, 0.9], [hi + 0.25 * (hi - md), 1]];
}

function probAtMost(minutes, r) {
  const k = knots(r);
  if (minutes <= k[0][0]) return 0;
  if (minutes >= k[4][0]) return 1;
  for (let i = 0; i < 4; i += 1) {
    const [x0, y0] = k[i];
    const [x1, y1] = k[i + 1];
    if (minutes >= x0 && minutes <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (minutes - x0)) / (x1 - x0);
  }
  return 1;
}

function quantile(p, r) {
  const target = Math.min(1, Math.max(0, p));
  const k = knots(r);
  for (let i = 0; i < 4; i += 1) {
    const [x0, y0] = k[i];
    const [x1, y1] = k[i + 1];
    if (target >= y0 && target <= y1) return y1 === y0 ? x1 : x0 + ((x1 - x0) * (target - y0)) / (y1 - y0);
  }
  return k[4][0];
}

function remainingRange(r, elapsed) {
  const done = probAtMost(elapsed, r);
  const still = 1 - done;
  if (still < 0.02) return { low: 10, median: 20, high: 45, overrun: true };
  const out = { overrun: false };
  [["low", 0.1], ["median", 0.5], ["high", 0.9]].forEach(([key, p]) => {
    out[key] = Math.max(1, Math.round(quantile(done + p * still, r) - elapsed));
  });
  return out;
}

function incidentStatus(journey, incident, remaining, elapsed, prior, prefix, lang) {
  const text = TEXT[lang];
  const scheduled = journey.stops[journey.stops.length - 1].scheduled;
  const total = {
    low: prior + elapsed + remaining.low,
    median: prior + elapsed + remaining.median,
    high: prior + elapsed + remaining.high,
  };
  const arrival = {
    earliest: addMinutes(scheduled, total.low),
    expected: addMinutes(scheduled, total.median),
    latest: addMinutes(scheduled, total.high),
  };
  let connection = null;
  let probability = null;
  let suggestion = null;
  const c = journey.connection;
  if (c) {
    probability = probAtMost((new Date(c.departure) - new Date(scheduled)) / 60000 - c.walk_min, total);
    connection = { time: hhmm(c.departure), station: c.station, probability };
  }
  const label = incidentLabel(journey, incident, lang);
  let message = prefix + pushMessage(label, remaining, arrival, connection, lang);
  if (c && probability < 0.5) {
    suggestion = nextReachable(c, arrival.expected);
    if (suggestion) message += text.suggestion.replace("{train}", suggestion.train).replace("{time}", hhmm(suggestion.departure));
  }
  const facts = {
    incident: label,
    clearance_minutes: { low: remaining.low, likely: remaining.median, high: remaining.high },
    new_arrival: { earliest: hhmm(arrival.earliest), likely: hhmm(arrival.expected), latest: hhmm(arrival.latest) },
    summary: message,
    train: journey.train, destination: journey.destination, status: text.stopped,
    minutes_stopped_so_far: Math.round(elapsed),
    weather: `${WEATHER[lang][journey.weather]}, ${journey.temperature_c}°C`,
  };
  if (connection) facts.connection = { time: connection.time, station: connection.station, chance_of_making_it: `${Math.round(probability * 100)}%` };
  if (suggestion) facts.suggested_connection = text.at.replace("{train}", suggestion.train).replace("{time}", hhmm(suggestion.departure));
  return {
    remaining, total_delay: total,
    arrival: { earliest: arrival.earliest, expected: arrival.expected, latest: arrival.latest },
    connection_probability: probability, suggestion, message, facts,
  };
}

function incidentLabel(journey, incident, lang) {
  const itype = Engine.bundle.rulebook[incident.type_id];
  const name = itype ? (lang === "fr" ? itype.label_fr : itype.label) : incident.short_label;
  if (incident.leg_index === undefined) return incident.label;
  const leg = journey.legs[incident.leg_index];
  return TEXT[lang].incident_label.replace("{type}", name).replace("{a}", leg.from_stop).replace("{b}", leg.to_stop);
}

function pushMessage(label, remaining, arrival, connection, lang) {
  const t = PUSH[lang];
  const parts = [
    t.clearance.replace("{label}", label).replace("{low}", remaining.low).replace("{high}", remaining.high),
    t.arrival.replace("{earliest}", hhmm(arrival.earliest)).replace("{latest}", hhmm(arrival.latest)).replace("{expected}", hhmm(arrival.expected)),
  ];
  if (connection) {
    const verdict = connection.probability >= 0.8 ? t.ok : connection.probability >= 0.5 ? t.risk : t.unlikely;
    parts.push(t.connection.replace("{time}", connection.time).replace("{station}", connection.station)
      .replace("{verdict}", verdict).replace("{p}", `${Math.round(connection.probability * 100)}%`));
  }
  return parts.join(" ");
}

function calmFacts(journey, delayMin, summary, lang, extra) {
  const text = TEXT[lang];
  const arrival = journey.stops[journey.stops.length - 1].scheduled;
  const facts = {
    train: journey.train, destination: journey.destination,
    status: delayMin < 1 ? text.on_time : text.delayed.replace("{minutes}", Math.round(delayMin)),
    scheduled_arrival: hhmm(arrival),
    estimated_arrival: hhmm(addMinutes(arrival, delayMin)),
    weather: `${WEATHER[lang][journey.weather]}, ${journey.temperature_c}°C`,
    summary,
  };
  const c = journey.connection;
  if (c) {
    const reach = addMinutes(arrival, delayMin + c.walk_min);
    facts.connection = {
      train: c.train, to: c.to, departs: hhmm(c.departure),
      status: reach <= c.departure ? text.on_track : text.will_be_missed,
    };
  }
  return extra ? { ...facts, ...extra } : facts;
}

function nextReachable(connection, arrival) {
  return connection.alternatives.find((alt) => addMinutes(arrival, connection.walk_min) <= alt.departure) || null;
}

function seasonalOdds(month, weights) {
  const odds = { ...weights };
  if (month === 11 || month === 12 || month <= 3) delete odds.heat;
  else if (month >= 5 && month <= 9) delete odds.snow;
  return odds;
}

function weightedChoice(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let pick = Math.random() * total;
  for (const [key, weight] of entries) {
    pick -= weight;
    if (pick <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function timeOfDay(isoText) {
  const hour = Number(isoText.slice(11, 13));
  if (hour >= 6 && hour < 9) return "rush_am";
  if (hour >= 9 && hour < 16) return "midday";
  if (hour >= 16 && hour < 19) return "rush_pm";
  if (hour >= 19 && hour < 23) return "evening";
  return "night";
}

function distance(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function iso(day, minutes) {
  const base = new Date(`${day}T00:00:00`);
  const d = new Date(base.getTime() + minutes * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function addMinutes(isoText, minutes) {
  const d = new Date(isoText);
  const next = new Date(d.getTime() + minutes * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}T${p(next.getHours())}:${p(next.getMinutes())}:${p(next.getSeconds())}`;
}

function hhmm(isoText) {
  return String(isoText).slice(11, 16);
}

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;
const round5 = (n) => Math.round(n * 1e5) / 1e5;
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const WEATHER = {
  en: { clear: "clear skies", rain: "rain", storm: "a storm with strong wind", heat: "a heatwave", snow: "snow" },
  fr: { clear: "ciel dégagé", rain: "pluie", storm: "tempête avec vent fort", heat: "canicule", snow: "neige" },
};
const TEMPERATURES = {
  clear: [[0, 9], [12, 26]], rain: [[3, 10], [10, 18]], storm: [[2, 9], [12, 22]],
  heat: [[30, 36], [31, 38]], snow: [[-6, 1], [-3, 2]],
};
const PUSH = {
  en: {
    clearance: "{label}. Expected clearance: {low}-{high} min (updating).",
    arrival: "New arrival: {earliest}-{latest} (likely {expected}).",
    connection: "Your {time} connection at {station}: {verdict} ({p}).",
    ok: "likely OK", risk: "at risk", unlikely: "unlikely, consider rebooking",
  },
  fr: {
    clearance: "{label}. Reprise estimée dans {low} à {high} min (mise à jour en cours).",
    arrival: "Nouvelle arrivée : {earliest}-{latest} (probablement {expected}).",
    connection: "Votre correspondance de {time} à {station} : {verdict} ({p}).",
    ok: "probablement assurée", risk: "menacée", unlikely: "peu probable, pensez à changer de train",
  },
};
const TEXT = {
  en: {
    welcome: "Welcome aboard {train} to {destination}. Scheduled arrival: {arrival}. Weather along the route: {weather}, {temperature}°C.",
    welcome_connection: " Your connection to {to} ({train}) leaves at {time}.",
    incident_label: "{type} between {a} and {b}",
    update: "Update {time}: ", overrun: "this is taking longer than our estimate. ",
    resumed: "{time}: traffic has resumed. The {type} lasted {true} min (our first estimate was {low}-{high} min). New arrival: {arrival}.",
    connection_ok: " You should make your {time} connection to {to}.",
    connection_missed: " You will miss your {time} connection",
    next_connection: "; the next one is {train} at {time}.",
    no_connection: "; there is no later train to {to} today.",
    suggestion: " Likely next connection: {train} at {time}.",
    at: "{train} at {time}",
    on_time: "on time", delayed: "delayed by {minutes} min", stopped: "stopped",
    on_track: "on track", will_be_missed: "will be missed",
    bad_request: "Unknown day, itinerary or train.",
    bad_order: "The destination must come after the origin on this train.",
  },
  fr: {
    welcome: "Bienvenue à bord du {train} à destination de {destination}. Arrivée prévue : {arrival}. Météo sur le trajet : {weather}, {temperature} °C.",
    welcome_connection: " Votre correspondance pour {to} ({train}) part à {time}.",
    incident_label: "{type} entre {a} et {b}",
    update: "Mise à jour {time} : ", overrun: "l'incident dure plus longtemps que notre estimation. ",
    resumed: "{time} : le trafic a repris. L'incident ({type}) a duré {true} min (notre première estimation : {low} à {high} min). Nouvelle arrivée : {arrival}.",
    connection_ok: " Vous devriez avoir votre correspondance de {time} pour {to}.",
    connection_missed: " Vous allez manquer votre correspondance de {time}",
    next_connection: " ; la suivante est le {train} à {time}.",
    no_connection: " ; il n'y a plus de train pour {to} aujourd'hui.",
    suggestion: " Prochaine correspondance possible : {train} à {time}.",
    at: "{train} à {time}",
    on_time: "à l'heure", delayed: "en retard de {minutes} min", stopped: "à l'arrêt",
    on_track: "assurée", will_be_missed: "sera manquée",
    bad_request: "Jour, itinéraire ou train inconnu.",
    bad_order: "La destination doit venir après le départ sur ce train.",
  },
};

if (typeof globalThis !== "undefined") globalThis.Engine = Engine;
if (typeof module !== "undefined" && module.exports) module.exports = { Engine, predict, boost, encode };
})();
