// The built-in report: the whole process, explained from beginner to expert.
// Numbers come from /api/report (computed from the project's own files) and,
// in green "Your trip right now" boxes, from the live simulation state.

const REPORT = { data: null, current: "overview" };

// tx() picks the French sentence when the header switch is on FR.
const tx = (en, fr) => (typeof LANG !== "undefined" && LANG === "fr" ? fr : en);
const field = (obj, key) => (LANG === "fr" && obj && obj[`${key}_fr`] ? obj[`${key}_fr`] : obj[key]);
const WORDS = {
  weekday: ["weekday", "semaine"], weekend: ["weekend", "week-end"],
  single: ["single", "voie unique"], double: ["double", "double voie"],
  urban: ["urban", "urbain"], rural: ["rural", "rural"],
  yes: ["yes", "oui"], no: ["no", "non"], nonstop: ["nonstop", "direct"],
  one: ["one track", "une voie"], both: ["both tracks", "les deux voies"],
  sector: ["a sector", "un secteur"], station: ["a station", "une gare"],
  train: ["the train only", "le train seul"], junction: ["a junction", "un aiguillage"],
  external: ["external", "externe"], security: ["security", "sûreté"],
  tragic: ["person accident", "accident de personne"], infrastructure: ["infrastructure", "infrastructure"],
  weather: ["weather", "météo"], technical: ["technical", "technique"],
  operational: ["operational", "exploitation"], planned: ["planned", "travaux"],
};
const word = (k) => (WORDS[k] ? tx(WORDS[k][0], WORDS[k][1]) : k);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${pad(Math.round(m % 60))}` : `${Math.round(m)} min`);
const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text || url)}</a>`;

function block(kind, tag, html) {
  return `<div class="block ${kind}"><span class="tag">${tag}</span>${html}</div>`;
}
const socrates = (question, answer) => block("socrates", tx("Think first", "Réfléchissez d'abord"),
  `<div>${question}</div><details class="answer"><summary>${tx("Show the answer", "Voir la réponse")}</summary>${answer}</details>`);
const simple = (html) => block("simple", tx("The simple picture", "L'image simple"), html);
const steps = (title, items) => block("steps", title, `<ol>${items.map((i) => `<li>${i}</li>`).join("")}</ol>`);
const expert = (html) => block("expert", tx("For experts", "Pour les experts"), html);
const warn = (html) => block("warn", tx("Be honest about this", "Soyons honnêtes"), html);
const sources = (items) => block("sources", tx("Sources", "Sources"), `<ul>${items.map(([url, what]) =>
  `<li>${link(url)}<br><small>${what}</small></li>`).join("")}</ul>`);
const live = (html) => block("live", tx("Your trip right now", "Votre trajet en ce moment"), html);
const noLive = (what) => block("live", tx("Your trip right now", "Votre trajet en ce moment"),
  `<em>${tx("Nothing yet.", "Rien pour l'instant.")} ${what}</em>`);
const badge = (kind) => ({
  real: `<span class="badge real">${tx("real data", "donnée réelle")}</span>`,
  sncf_figure: `<span class="badge real">${tx("SNCF figure", "chiffre SNCF")}</span>`,
  estimate: `<span class="badge estimate">${tx("our estimate", "notre estimation")}</span>`,
  synthetic: `<span class="badge synthetic">${tx("synthetic", "synthétique")}</span>`,
}[kind]);

function table(headers, rows, numeric = []) {
  return `<table class="rtable"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numeric.includes(i) ? "num" : ""}">${c}</td>`).join("")}</tr>`).join("")
  }</tbody></table>`;
}

// --- Live data helpers ------------------------------------------------------------------
const liveJourney = () => state.journey;
function liveIncident() {
  if (state.incident) return { data: state.incident.data, active: state.incident };
  const last = [...state.log].reverse().find((e) => e.data);
  return last ? { data: last.data, entry: last } : null;
}

// Same curve as impact_engine.py: straight lines through the 10/50/90% points.
function knots(r) {
  const { low: lo, median: md, high: hi } = r;
  return [[Math.max(0, lo - 0.25 * (md - lo)), 0], [lo, 0.1], [md, 0.5], [hi, 0.9], [hi + 0.25 * (hi - md), 1]];
}
function cdf(x, r) {
  const k = knots(r);
  if (x <= k[0][0]) return 0;
  if (x >= k[4][0]) return 1;
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = k[i], [x1, y1] = k[i + 1];
    if (x >= x0 && x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return 1;
}

// A small chart of the curve "share of incidents cleared after x minutes".
function cdfChart(r, marker, markerLabel, shadeBefore) {
  const W = 860, H = 270, L = 60, B = 40, T = 20, Rr = 20;
  const maxX = Math.max(knots(r)[4][0], marker || 0) * 1.08;
  const X = (x) => L + ((W - L - Rr) * x) / maxX;
  const Y = (y) => H - B - (H - B - T) * y;
  const pts = knots(r).map(([x, y]) => `${X(x)},${Y(y)}`).join(" ");
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%">`;
  if (shadeBefore) s += `<rect x="${X(0)}" y="${T}" width="${X(shadeBefore) - X(0)}" height="${H - B - T}" fill="#fee2e2"/>
    <text x="${X(shadeBefore / 2)}" y="${T + 16}" text-anchor="middle" font-size="12" fill="#b91c1c">${tx("ruled out", "écarté")}</text>`;
  for (const y of [0, 0.1, 0.5, 0.9, 1]) {
    s += `<line x1="${L}" x2="${W - Rr}" y1="${Y(y)}" y2="${Y(y)}" stroke="#e2e8f0"/>
      <text x="${L - 8}" y="${Y(y) + 4}" text-anchor="end" font-size="12" fill="#5b6b82">${pct(y)}</text>`;
  }
  const step = maxX > 300 ? 60 : maxX > 120 ? 30 : 15;
  for (let x = 0; x <= maxX; x += step) {
    s += `<text x="${X(x)}" y="${H - B + 18}" text-anchor="middle" font-size="12" fill="#5b6b82">${x}</text>`;
  }
    s += `<text x="${(L + W) / 2}" y="${H - 4}" text-anchor="middle" font-size="12" fill="#5b6b82">${tx("minutes", "minutes")}</text>`;
  s += `<polyline points="${pts}" fill="none" stroke="#1f3a68" stroke-width="3"/>`;
  [["10%", r.low, 0.1], ["50%", r.median, 0.5], ["90%", r.high, 0.9]].forEach(([n, x, y]) => {
    s += `<circle cx="${X(x)}" cy="${Y(y)}" r="5" fill="#d6001c"/>
      <text x="${X(x) + 8}" y="${Y(y) - 8}" font-size="12" font-weight="700" fill="#0c1e3e">${n}: ${Math.round(x)} min</text>`;
  });
  if (marker !== undefined && marker !== null) {
    s += `<line x1="${X(marker)}" x2="${X(marker)}" y1="${T}" y2="${H - B}" stroke="#15803d" stroke-width="2" stroke-dasharray="6 4"/>
      <text x="${X(marker) + 6}" y="${Y(cdf(marker, r)) + 18}" font-size="12.5" font-weight="700" fill="#15803d">${markerLabel}</text>`;
  }
  return `${s}</svg>`;
}

// --- Chapters ------------------------------------------------------------------------------
function chapters() {
  return [
    ["overview", tx("The whole process", "Tout le processus")],
    ["problem", tx("1. The problem", "1. Le problème")],
    ["timetable", tx("2. Real trains & itineraries", "2. Vrais trains et itinéraires")],
    ["position", tx("3. Where the train is", "3. Où est le train")],
    ["incidents", tx("4. Incident types & durations", "4. Types d'incidents et durées")],
    ["synthetic", tx("5. Why & how synthetic data", "5. Pourquoi et comment les données synthétiques")],
    ["features", tx("6. What the model looks at", "6. Ce que le modèle regarde")],
    ["model", tx("7. The model: a range", "7. Le modèle : une fourchette")],
    ["updating", tx("8. Why the estimate changes", "8. Pourquoi l'estimation change")],
    ["arrival", tx("9. Arrival & connection", "9. Arrivée et correspondance")],
    ["results", tx("10. Does it work? Results", "10. Est-ce que ça marche ? Résultats")],
    ["messages", tx("11. Messages & assistant", "11. Messages et assistant")],
    ["weather", tx("12. Weather", "12. Météo")],
    ["limits", tx("13. Limits & next steps", "13. Limites et suite")],
    ["sources", tx("14. All sources", "14. Toutes les sources")],
  ];
}

const RENDER = {
  overview(d) {
    const src = d.timetable.source;
    return `
      <h2>The whole process</h2>
      <p class="lead">This simulation is also our report. Each chapter answers one question, starting
      from zero and ending with what an expert would check. Click any step.</p>
      <div class="process">${[
        ["problem", "1. The problem", "Passengers are told nothing useful during incidents."],
        ["timetable", "2. Real trains", `${tx("Official SNCF timetable,", "Horaire officiel SNCF,")} ${src.valid_from} ${tx("to", "au")} ${src.valid_to}.`],
        ["position", "3. Where the train is", "Real station coordinates, position at the minute of the incident."],
        ["incidents", "4. Durations", "12 incident types, 4 with official SNCF figures."],
        ["synthetic", "5. Synthetic data", `${d.training.n_incidents} generated incidents (no public log exists).`],
        ["features", "6. Features", "11 facts the model is allowed to see."],
        ["model", "7. The model", "Three models: 10%, 50% and 90% points of the duration."],
        ["updating", "8. Updating", "The range is re-read as minutes pass."],
        ["arrival", "9. Consequences", "Arrival range and chance to make the connection."],
        ["results", "10. Results", `Error ${d.metrics.model.mae.toFixed(1)} min vs ${d.metrics.baseline.mae.toFixed(1)} min; ${pct(d.metrics.model.coverage)} inside the range.`],
        ["messages", "11. Messages", "The model computes, the language model only phrases."],
        ["limits", "13. Limits", "What this does not prove, and how to go further."],
      ].map(([id, t, s]) => `<div data-goto="${id}"><b>${t}</b><small>${s}</small></div>`).join("")}</div>

      <h4>How to read each chapter</h4>
      ${socrates("An orange box asks you a question first. Try to answer before opening it.",
        "That is the Socratic method: you understand better what you found yourself.")}
      ${simple("A blue box gives an everyday picture, no maths.")}
      ${steps("Step by step", ["A white box walks through the method, one step at a time."])}
      ${expert("A grey box gives the exact technical detail: formulas, parameters, file names.")}
      ${block("live", "Your trip right now", "A green box shows the real numbers of the trip you are simulating.")}

      <h4>What is real, what is estimated, what is synthetic</h4>
      ${table(["Element", "Status", "Where it comes from"], [
        ["Train numbers, stops, times, connecting TER trains", badge("real"), `SNCF timetable (GTFS), version ${esc(src.feed_version)}`],
        ["Station coordinates (latitude, longitude)", badge("real"), "Same SNCF timetable (stops.txt)"],
        ["Single or double track on each line", badge("real"), "Wikipedia pages citing SNCF technical documents (chapter 2)"],
        ["Durations: person on track, abandoned baggage, broken rail", badge("sncf_figure"), "Official SNCF pages (chapter 4)"],
        ["Durations of the 8 other incident types", badge("estimate"), "Our estimates, labelled as such (chapter 4)"],
        [`The ${d.training.n_incidents} incidents the model learned from`, badge("synthetic"), "Generated by src/generate_data.py (chapter 5)"],
        ["The incident in your trip and its true duration", badge("synthetic"), "Drawn by the same process (chapter 5)"],
        ["Weather during your trip", badge("synthetic"), "Random, with the generator's odds (chapter 12)"],
        ["Delay statistics in chapter 1", badge("real"), "RetardTrain.fr, computed from SNCF's real-time feed"],
      ])}`;
  },

  problem(d) {
    const rw = d.real_world;
    return `
      <h2>1. The problem</h2>
      <p class="lead">When something unusual happens on the line, passengers hear "traffic interrupted,
      resumption time undetermined". Our project gives them an honest range instead.</p>
      ${socrates("You are on a stopped train. The announcement says: <em>resumption time undetermined</em>. "
        + "Your connection leaves in 40 minutes. Do you stay, or do you rebook now?",
        "You cannot decide: you have no number. If it lasts 10 minutes, rebooking was a waste. If it lasts "
        + "2 hours, staying was a mistake. <strong>The uncertainty hurts more than the delay itself</strong>, "
        + "because it stops you from planning.")}
      ${simple("Think of a food delivery app. \"Your order is on its way\" is frustrating. \"Arriving between "
        + "19:25 and 19:40\" is reassuring, even if it is late, because you can plan. We want the same for trains.")}
      <h4>What real data says about the size of the problem</h4>
      ${table(["Train type", "Share of trains disrupted", "Average delay of disrupted trains"],
        Object.keys(rw.avg_delay_by_type).map((k) => [k, pct(rw.share_disrupted_by_type[k]), `${rw.avg_delay_by_type[k]} min`]), [1, 2])}
      <p class="lead">${tx("Period:", "Période :")} <strong>${esc(field(rw, "period"))}</strong>. ${rw.disrupted_trains.toLocaleString(LANG === "fr" ? "fr-FR" : "en-GB")} ${tx("trains were at least 10 minutes late or cancelled, and", "trains ont eu au moins 10 minutes de retard ou ont été annulés, et")} <strong>${pct(rw.share_without_cause)} ${tx("of them had no cause published at all", "d'entre eux n'avaient aucune cause publiée")}</strong>. ${tx("Passengers often do not even know what happened, let alone how long it will last.", "Les voyageurs ne savent souvent même pas ce qui s'est passé, encore moins combien de temps cela va durer.")}</p>
      <p>Animals alone: SNCF counts about 3,000 collisions with wildlife in 2025 and 5,000 hours of
      accumulated delay per year.</p>
      ${steps("What our system does", [
        "As soon as an incident starts, estimate how long it will take to clear, as a <strong>range</strong> (chapter 7).",
        "Translate that into what the passenger cares about: new arrival time and the chance to make the connection (chapter 9).",
        "Re-compute every 15 minutes as we learn more (chapter 8).",
        "Tell the passenger with a push message and answer questions with an assistant that cannot invent numbers (chapter 11).",
      ])}
      ${expert("Why a range and not one number? Costs are asymmetric: announcing 20 minutes when it takes 2 hours "
        + "makes people miss connections; announcing 2 hours when it takes 20 minutes makes them rebook for nothing. "
        + "A range with a known confidence (10% / 50% / 90%) lets each passenger decide according to their own risk.")}
      ${sources([
        [rw.source_url, `Delay statistics, period ${rw.period}, copied on ${rw.copied_on}. Computed by RetardTrain.fr from SNCF's real-time feed.`],
        ["https://www.groupe-sncf.com/fr/groupe/coulisses/circulation-trains/animaux-pres-voies", "SNCF: 3,000 wildlife collisions in 2025, 5,000 hours of delay per year."],
      ])}`;
  },

  timetable(d) {
    const src = d.timetable.source;
    const j = liveJourney();
    const days = state.options.days;
    const itRows = d.timetable.days[0].itineraries.map((i) => [
      esc(field(i, "label")), esc(field(i, "line_name")), `<strong>${word(i.track_layout)}</strong><br><small>${esc(field(i, "track_note"))}</small>`,
      i.sources.map((s) => link(s.url, s.title)).join("<br>")]);
    const lists = days.map((day) => day.itineraries.map((it) => `
      <details class="trains"><summary>${esc(day.date)} (${word(day.day_type)}) - ${esc(field(it, "label"))}: ${it.trains.length} ${tx("trains", "trains")}</summary>
      <div class="scroll">${table(["Train", "Departs", "Arrives", "Intermediate stops (arrival)"], it.trains.map((t) => {
        const s = t.stops;
        return [esc(t.id), `${s[0].departure} ${esc(s[0].name)}`, `${s[s.length - 1].arrival} ${esc(s[s.length - 1].name)}`,
          s.slice(1, -1).map((x) => `${esc(x.name)} ${x.arrival}`).join(", ") || tx("nonstop", "direct")];
      }))}</div>
      ${it.connection ? `<p><small>Connecting trains ${esc(it.connection.station_name)} → ${esc(it.connection.to_name)}:
        ${it.connection.trains.map((c) => `${esc(c.id)} ${c.departure}`).join(", ")}</small></p>` : ""}
      </details>`).join("")).join("");

    return `
      <h2>2. Real trains & itineraries</h2>
      <p class="lead">Every train you can pick is a real SNCF train, with its real number, stops and times.</p>
      ${socrates("How can we know that a TGV leaves Paris at 15:52 and stops at Le Creusot at 17:12, without asking SNCF?",
        "SNCF publishes its complete timetable as <strong>open data</strong>, free for anyone, in a standard format called GTFS.")}
      ${simple(`GTFS is a folder of spreadsheets. The important ones:
        <ul><li><strong>stops.txt</strong>: every station, with its GPS position.</li>
        <li><strong>trips.txt</strong>: every train (its number, for example 6621).</li>
        <li><strong>stop_times.txt</strong>: one line per train per station, for example "train 6621, Le Creusot-TGV, arrives 17:12".
        In the version we use: 512,178 lines for 58,749 trains across France.</li>
        <li><strong>calendar_dates.txt</strong>: on which days each train runs.</li></ul>`)}
      <h4>The file we used</h4>
      ${table(["", ""], [
        ["Publisher", esc(src.publisher) + " (official open data)"],
        ["Dataset page", link(src.page)],
        ["File", `<code>${esc(src.url)}</code>`],
        ["Version", esc(src.feed_version)],
        ["Period covered", `<strong>${esc(src.valid_from)} to ${esc(src.valid_to)}</strong>`],
        ["Published on", esc(src.published_on)],
        ["Days we load", days.map((x) => `${x.date} (${x.day_type})`).join(", ")],
      ])}
      ${steps("How src/build_routes.py turns the file into our itineraries", [
        "Download the zip file above (5.5 MB, 94 MB once unzipped) into <code>data/raw/gtfs/</code>.",
        "Read stops, trips, stop_times and calendar_dates.",
        `Keep only the trains running on our two reference days: ${days.map((x) => x.date).join(" and ")}. One weekday, one Saturday, because "weekday or weekend" is one of the things the model looks at.`,
        "For each itinerary, keep every train that stops at the origin and <em>later</em> at the destination, of the right kind (TGV INOUI and OUIGO for high-speed lines, TER for the mountain line).",
        "Attach the track layout (single or double track) of the line, from the sources below.",
        "For Paris → Lyon, also list every real TER from Lyon Part-Dieu to Grenoble, for the connection.",
        "Write <code>data/routes.json</code> (used by the simulation) and <code>docs/ITINERARIES.md</code> (the same list, for humans).",
      ])}
      <h4>The three itineraries</h4>
      ${table(["Itinerary", "Line", "Track", "Source for the track"], itRows)}
      <h4>Every train, every stop (click to open)</h4>
      ${lists}
      ${j ? live(`${tx("You are on", "Vous êtes dans le")} <strong>${esc(j.train)}</strong> ${tx("on", "le")} ${esc(j.date)} (${word(j.day_type)}), ${tx("from", "de")} ${esc(j.origin)} ${tx("to", "vers")} ${esc(j.destination)}.
        ${table(["Leg", "Straight-line length", "Track"], j.legs.map((l) => [`${esc(l.from_stop)} → ${esc(l.to_stop)}`, `${l.length_km} km`, word(l.track_layout)]), [1])}`)
        : noLive("Book a train to see its details here.")}
      ${expert(`<ul>
        <li>Stations are identified by their 8-digit UIC code, for example 87686006 = Paris Gare de Lyon. Station names are kept exactly as SNCF writes them ("Paris Gare de Lyon Hall 1 - 2").</li>
        <li>The train brand (TGV INOUI, OUIGO, TER) is read from the stop identifier, for example <code>StopPoint:OCETGV INOUI-87686006</code>.</li>
        <li>GTFS times can go past 24:00 for trains running after midnight; we convert them to minutes.</li>
        <li>Two trains sometimes leave at the same minute with two numbers (for example 6615 and 6685): that is one double TGV made of two coupled units.</li>
        <li>Between two stations we move the train at a constant speed. Real trains accelerate and brake; this only affects where we place an incident (chapter 3).</li></ul>`)}
      ${sources([[src.page, `SNCF timetable, version ${src.feed_version}, valid ${src.valid_from} to ${src.valid_to}.`],
        ...d.timetable.days[0].itineraries.flatMap((i) => i.sources.map((s) => [s.url, s.title]))])}`;
  },

  position(d) {
    const a = d.assumptions;
    const inc = liveIncident();
    const j = liveJourney();
    let liveHtml = noLive("Trigger an incident: this box will show exactly where the train was.");
    if (inc && j) {
      const w = inc.data.where, f = inc.data.features;
      const leg = j.legs.find((l) => inc.data.label.includes(l.from_stop) && inc.data.label.includes(l.to_stop)) || j.legs[0];
      liveHtml = live(`Incident: <strong>${esc(inc.data.label)}</strong>.
        <ol><li>The leg ${esc(leg.from_stop)} → ${esc(leg.to_stop)} is <strong>${leg.length_km} km</strong> in a straight line.</li>
        <li>The train had covered <strong>${w.km_after_from_stop} km</strong> of it (that is ${pct(w.km_after_from_stop / leg.length_km || 0)} of the scheduled time of the leg).</li>
        <li>Position: latitude ${w.lat}, longitude ${w.lon}.</li>
        <li>Nearest big-city station: <strong>${esc(w.nearest_big_city)}</strong>, at <strong>${w.distance_to_big_city_km} km</strong>.</li>
        <li>${w.distance_to_big_city_km} km ${w.distance_to_big_city_km <= a.urban_radius_km ? "≤" : ">"} ${a.urban_radius_km} km, so zone = <strong>${f.zone}</strong>.</li>
        <li>${w.distance_to_big_city_km} km ${w.distance_to_big_city_km <= a.depot_radius_km ? "≤" : ">"} ${a.depot_radius_km} km, so maintenance base near = <strong>${f.near_depot}</strong>.</li></ol>`);
    }
    return `
      <h2>3. Where the train is</h2>
      <p class="lead">The same incident does not last as long everywhere. So we compute where the train is at the minute it happens.</p>
      ${socrates("Is a broken rail 5 km outside Paris the same as a broken rail in the middle of the countryside, 140 km from any city?",
        "No. In a city, repair teams arrive in minutes. In the countryside they first have to drive there. In our tests, the same broken rail "
        + "on the same TGV gave <strong>113 to 175 min</strong> near Paris and <strong>118 to 207 min</strong> in the countryside.")}
      ${simple("Like the moving dot in a GPS app: we know when the train left the last station and when it is due at the next one, "
        + "so we know how far along it is. Halfway in time means halfway in distance.")}
      ${steps("Step by step", [
        "The simulation clock tells us how many minutes the train has been running since the last station.",
        "<strong>Fraction</strong> = minutes since the last station ÷ scheduled minutes between the two stations. Example: 30 min out of a 60-min leg = 0.5.",
        "<strong>Position</strong> = start + fraction × (end - start), for latitude and for longitude. The coordinates are the real ones from the SNCF timetable.",
        "We measure the distance from that point to every big-city station (Paris, Lyon, Grenoble, Lille: cities above 100,000 inhabitants).",
        `If the nearest one is within <strong>${a.urban_radius_km} km</strong>, the incident is <em>urban</em>; otherwise <em>rural</em>.`,
        `If it is within <strong>${a.depot_radius_km} km</strong>, we consider a maintenance team is <em>near</em>.`,
      ])}
      ${liveHtml}
      <div class="formula">distance = 2 × 6371 km × asin( √( sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlon/2) ) )      (haversine formula)</div>
      ${warn(`The ${a.urban_radius_km} km and ${a.depot_radius_km} km thresholds are <strong>our assumptions</strong>. The exact locations of SNCF Réseau
        maintenance teams are not in the open data. Straight-line distances are a little shorter than the real track
        (Paris Gare de Lyon to Lyon Part-Dieu: 391 km in a straight line; the LGV Sud-Est alone is 409 km of track).`)}
      ${expert("Implemented in <code>Simulator.locate()</code> in <code>src/simulation.py</code>. The result feeds three model inputs: "
        + "<code>zone</code>, <code>near_depot</code> and <code>length_km</code> (length of the leg).")}`;
  },

  incidents(d) {
    const inc = liveIncident();
    const rows = d.rulebook.map((r) => [
      `<strong>${esc(field(r, "label"))}</strong><br><small>${word(r.category)}, ${tx("blocks", "bloque")} : ${word(r.tracks_blocked)}</small>`,
      `${r.dur_min}`, `${r.dur_median}`, `${r.dur_max}`, badge(r.evidence),
      `<small>${esc(field(r, "source_note"))}</small><br><small>${link(r.source_url, tx("source", "source"))}</small>`]);
    return `
      <h2>4. Incident types & durations</h2>
      <p class="lead">Twelve kinds of incidents, each with a typical duration. For some, SNCF publishes official figures; for the others we estimated, and we say so.</p>
      ${socrates("How long does it take to clear an animal from the track? How would you even find out?",
        "We looked for official figures first. SNCF publishes some (a person on the track: 2 h 30 on average). For many causes, "
        + "no public figure exists, so we made an estimate from SNCF's own description of the procedure, and we label it <em>our estimate</em>.")}
      ${simple("For each type we keep three numbers: the shortest typical case (<strong>min</strong>), the middle case (<strong>median</strong>: half of the "
        + "cases are shorter, half longer) and the longest typical case (<strong>max</strong>). Example: person on the track, 120 / 150 / 180 minutes, "
        + "because SNCF says 2 h 30 on average, 3 h on high-speed lines, 2 h elsewhere.")}
      <div class="scroll">${table(["Type", "Min", "Median", "Max", "Evidence", "What the source says"], rows, [1, 2, 3])}</div>
      ${socrates("Why not simply show passengers this table's min and max?",
        "That is exactly our <strong>baseline</strong>: the simplest possible answer. It ignores where, when and in what weather the incident happens. "
        + "Chapter 10 shows the model beats it: its middle estimate is much closer to the truth.")}
      ${inc ? live(`${tx("Your incident:", "Votre incident :")} <strong>${esc(incidentText(inc.data))}</strong>. ${tx("The table alone says", "Le tableau seul dit")} ${inc.data.rulebook.low}-${inc.data.rulebook.high} min
        (${tx("median", "médiane")} ${inc.data.rulebook.median}). ${tx("The model, which also knows the place, time and weather, says", "Le modèle, qui connaît aussi le lieu, l'heure et la météo, dit")}
        <strong>${inc.data.prediction.low}-${inc.data.prediction.high} min</strong> (${tx("median", "médiane")} ${inc.data.prediction.median}).
        ${tx("Evidence for this type:", "Preuve pour ce type :")} ${badge(inc.data.rulebook.evidence)} ${link(inc.data.rulebook.source_url, tx("source", "source"))}`)
        : noLive("Trigger an incident to compare the table with the model.")}
      ${expert("Stored in <code>data/incident_types.csv</code> (columns <code>dur_min, dur_median, dur_max, evidence, source_url, source_note</code>). "
        + "The baseline is <code>src/baseline.py</code>: one dictionary lookup, no learning.")}`;
  },

  synthetic(d) {
    const t = d.training;
    const ex = t.example_incident;
    const weightRows = Object.entries(t.type_weights).map(([k, v]) => [esc(k), v, pct(v / Object.values(t.type_weights).reduce((a, b) => a + b, 0))]);
    const ruleRows = t.rules.map((r) => [esc(field(r, "name")), `× ${r.factor}`, `<code>${esc(r.when)}</code>`, esc(field(r, "why"))]);
    const byType = t.by_type.map((r) => [esc(r.type_id), r.count, r.p10, r.median, r.p90]);
    const example = 1.2 * 1.15 * 1.05 * 1.25 * 1.08;
    return `
      <h2>5. Why & how synthetic data</h2>
      <p class="lead">To learn, a model needs thousands of past examples. That list is not public, so we built one, calibrated on the real figures of chapter 4.</p>
      ${socrates("To train a model you need examples like \"this incident, at this place, lasted 73 minutes\". Where would you find thousands of them?",
        "SNCF keeps such logs internally, but they are not public. The open real-time feeds (GTFS-RT, SIRI) give each train's delay and short alerts, "
        + "not a clean list of <em>incident started / cleared / cause</em>. So we <strong>generate</strong> realistic examples.")}
      ${simple("Like a flight simulator: the flights are not real, but they follow real physics, and pilots really learn from them. "
        + "Our \"physics\" is the table of chapter 4 plus a few common-sense rules (single track is slower to clear, and so on).")}
      ${steps(`How one incident is made (real example: incident n°${ex.incident_id})`, [
        `Pick a type, with the frequencies below (common things are common): here <strong>${esc(ex.type_id)}</strong>.`,
        `Pick a section of line from our small network (<code>data/network.csv</code>): here <strong>${esc(ex.segment_id)}</strong> on ${esc(ex.line_id)}.`,
        `Pick the weather (clear 62%, rain 20%, storm 8%, heat 6%, snow 4%): here <strong>${esc(ex.weather)}</strong>.`,
        `Pick a time of day (rush hours are busier): here <strong>${esc(ex.time_of_day)}</strong>, on ${esc(ex.start_time)} (a ${esc(ex.day_type)}).`,
        "Draw a base duration between the type's min and max, most often near the median (a <em>triangular</em> draw).",
        "Multiply by the context rules below.",
        `Keep it between the min and 1.5 × max. Result: <strong>${ex.resolution_minutes} minutes</strong>, cleared at ${esc(ex.resolved_time)}.`,
      ])}
      <h4>Frequencies of incident types (our choice, not sourced)</h4>
      <div class="scroll">${table(["Type", "Weight", "Share"], weightRows, [1, 2])}</div>
      <h4>Context rules</h4>
      ${table(["Situation", "Effect", "When", "Why"], ruleRows)}
      ${simple(`Example: a tree on a single track, far from any base, in the countryside, in a storm, at rush hour:
        1.20 × 1.15 × 1.05 × 1.25 × 1.08 = <strong>× ${example.toFixed(2)}</strong>. A 75-minute median becomes about ${Math.round(75 * example)} minutes.`)}
      <h4>What we generated</h4>
      ${table(["", ""], [
        ["Incidents", `<strong>${t.n_incidents}</strong>`],
        ["Trains affected (domino effect)", t.n_impacted_trains.toLocaleString("en-GB")],
        ["Dates", `${t.period_from} to ${t.period_to} (synthetic dates)`],
        ["Random seed", `${t.seed} (same seed = exactly the same data every time)`],
      ])}
      <div class="scroll">${table(["Type", "Count", "10% under (min)", "Median (min)", "90% under (min)"], byType, [1, 2, 3, 4])}</div>
      ${warn("This is the most important limit of the project: <strong>the model learns the rules we wrote</strong>. Good results prove that the method works "
        + "and that the range is honest <em>if reality behaves like our rules</em>. They do not prove the model would be this accurate on real SNCF incidents. "
        + "Chapter 13 explains how to get real data.")}
      ${expert(`<ul><li>Code: <code>src/generate_data.py</code>. Outputs: <code>incidents.csv</code> (the event log), <code>impact.csv</code> (one incident → several delayed trains)
        and <code>training_data.csv</code> (the flat table the model learns from).</li>
        <li>Base duration: <code>random.triangular(min, max, median)</code>, then × the product of the rules, clipped to [min, 1.5 × max].</li>
        <li><strong>Leakage</strong> avoided: <code>resolved_time</code> is removed from the training table, because it contains the answer.</li>
        <li>The training network (6 sections) is not the same as the simulation's real lines. That is on purpose: the model learns from
        <em>characteristics</em> (single track, rural...), not from line names, so it can be used on lines it has never seen.</li></ul>`)}`;
  },

  features(d) {
    const inc = liveIncident();
    const row = d.training.example_training_row;
    return `
      <h2>6. What the model looks at</h2>
      <p class="lead">The model only sees what would really be known at the minute the incident starts.</p>
      ${socrates("If you had to guess how long an incident will last, what would you want to know?",
        "What happened, where (single track? city or countryside? is a team nearby?), when (rush hour? weekend?) and the weather. "
        + "Those are exactly our 11 <strong>features</strong>.")}
      ${table(["Feature", "Kind", "Meaning"], d.features.map((f) => [`<code>${f.name}</code>`, tx(f.kind, f.kind === "category" ? "catégorie" : "nombre"), esc(field(f, "description"))]))}
      <h4>One real row of the training table</h4>
      ${table(Object.keys(row).map((k) => `<small>${k}</small>`), [Object.values(row).map((v) => `<small>${esc(v)}</small>`)])}
      <p>The last column, <code>resolution_minutes</code>, is the <strong>label</strong>: the answer the model must learn to predict.</p>
      ${inc ? live(`The row sent to the model for your incident:${table(Object.keys(inc.data.features).map((k) => `<small>${k}</small>`),
        [Object.values(inc.data.features).map((v) => `<small>${esc(v)}</small>`)])}`) : noLive("Trigger an incident to see the exact row sent to the model.")}
      ${expert("Text features are turned into numbers by <strong>one-hot encoding</strong>: <code>weather = snow</code> becomes five columns "
        + "(clear 0, rain 0, storm 0, heat 0, snow 1). <code>length_km</code> stays a number. Unknown values at prediction time are ignored "
        + "(<code>handle_unknown=\"ignore\"</code>) instead of crashing. Note: our real legs can be much longer (280 km nonstop) than the training "
        + "sections (up to 58 km); tree-based models then treat them like the longest sections they have seen.")}`;
  },

  model(d) {
    const m = d.model;
    const inc = liveIncident();
    let liveHtml = noLive("Trigger an incident to see the model's answer for it.");
    if (inc) {
      const p = inc.data.prediction;
      const truth = inc.entry && inc.entry.actual !== null
        ? `<br>${tx("Result: it really lasted", "Résultat : cela a vraiment duré")} <strong>${inc.entry.actual} min</strong>, <strong class="${inc.entry.inside ? "good" : "bad"}">${inc.entry.inside ? tx("inside", "dans") : tx("outside", "en dehors de")}</strong> ${tx("our range.", "notre fourchette.")}`
        : `<br>${tx("The true duration is hidden until the incident is over.", "La durée réelle reste cachée tant que l'incident n'est pas terminé.")}`;
      liveHtml = live(`For <strong>${esc(inc.data.label)}</strong> the three models answered:
        <strong>10%: ${p.low} min, 50%: ${p.median} min, 90%: ${p.high} min</strong>.
        In words: "most likely about ${dur(p.median)}; only 1 chance in 10 to be under ${p.low} min, 1 in 10 to be over ${p.high} min".${truth}
        ${inc.entry && inc.entry.actual !== null ? cdfChart(p, inc.entry.actual, tx(`real duration: ${inc.entry.actual} min`, `durée réelle : ${inc.entry.actual} min`)) : cdfChart(p)}`);
    }
    return `
      <h2>7. The model: a range</h2>
      <p class="lead">Three small models give three numbers: a duration that 10% of similar incidents stay under, the middle one (50%), and one that 90% stay under.</p>
      ${socrates("You ask 10 friends how long their commute takes: 25, 30, 32, 35, 40, 42, 45, 50, 60, 90 minutes. You want a range that is right for 8 of them. What do you answer?",
        "Drop the shortest and the longest: <strong>30 to 60 minutes</strong>, middle 40. That is a 10%-90% range with its median. "
        + "Our model does the same, but for incidents, and it adapts the range to the situation.")}
      ${simple("The model is like an experienced controller who has seen thousands of incidents. It does not say \"it will take 52 minutes\". "
        + "It says \"usually about 52, rarely under 30, rarely over 110\". That is more honest, and more useful.")}
      ${steps("How the model learns (gradient boosting)", [
        "Start with a very rough guess: the same duration for every incident.",
        "Build a tiny decision tree that asks yes/no questions (\"single track?\", \"person on the track?\") to correct the biggest mistakes.",
        "Build a second tiny tree that corrects what the first one still gets wrong. Then a third, and so on: 100 trees.",
        "The final answer is the rough guess plus all the small corrections.",
        "We do this three times, with three different ways of counting mistakes, to get the 10%, 50% and 90% points.",
      ])}
      ${simple("How do you teach a model the \"90% point\"? You punish it <strong>9 times more</strong> when the truth is above its answer than when it is below. "
        + "To avoid punishment, it pushes its answer up until only about 10% of cases are above. That is the <em>quantile loss</em>.")}
      <div class="formula">quantile loss for level q:   if truth > answer: q × (truth - answer)
                            if truth < answer: (1 - q) × (answer - truth)
q = 0.9  →  under-estimating costs 0.9, over-estimating costs 0.1  (9 times less)</div>
      ${liveHtml}
      ${expert(`<ul><li>${esc(m.algorithm)}, one model per level ${m.quantiles.join(", ")} (scikit-learn defaults: 100 trees, depth 3, learning rate 0.1, <code>random_state=42</code>).</li>
        <li>Pipeline: <code>ColumnTransformer</code> (one-hot for categories, numbers unchanged) → regressor. Code: <code>src/train.py</code>, <code>src/predict.py</code>.</li>
        <li>Data: ${m.split}: ${m.n_train} incidents to learn, ${m.n_test} kept aside for the test (chapter 10).</li>
        <li>Three separate models can occasionally cross (the 10% above the 50%); we sort the three answers to fix that.</li>
        <li>Why not a neural network? ${m.n_train} rows of table data: boosted trees are the standard, fast and explainable choice. LightGBM would also work.</li></ul>`)}`;
  },

  updating() {
    const inc = state.incident || null;
    let liveHtml = noLive("Trigger an incident and wait: each update will appear here.");
    const src = inc || [...state.log].reverse().find((e) => e.history);
    if (src) {
      const data = inc ? inc.data : src.data;
      const hist = inc ? inc.history : src.history;
      const elapsed = inc ? Math.round(stoppedFor()) : null;
      liveHtml = live(`${tx("First estimate for", "Première estimation pour")} ${esc(incidentText(data))}: ${data.prediction.low}-${data.prediction.high} min. ${tx("Updates so far:", "Mises à jour :")}
        ${table([tx("Stopped for", "À l'arrêt depuis"), tx("Still to wait: low", "Encore : bas"), tx("median", "médiane"), tx("high", "haut")], hist.map((h) => [`${h.elapsed} min`, `${h.low} min`, `${h.median} min`, `${h.high} min${h.overrun ? tx(" (overrun)", " (dépassé)") : ""}`]), [1, 2, 3])}
        ${inc ? cdfChart(data.prediction, elapsed, tx(`stopped for ${elapsed} min`, `à l'arrêt depuis ${elapsed} min`), elapsed) : ""}`);
    }
    return `
      <h2>8. Why the estimate changes</h2>
      <p class="lead">Every 15 minutes, the remaining time is re-computed from what we now know: the incident is not over yet.</p>
      ${socrates("We announced 45 to 124 minutes. 40 minutes have passed and it is still blocked. Is \"45 minutes in total\" still likely? Is \"10 minutes in total\" still possible?",
        "\"10 minutes in total\" is impossible now: we are already at 40. Every outcome shorter than 40 minutes is <strong>ruled out</strong>. "
        + "So we keep only the outcomes that are still possible and read the 10%, 50% and 90% points again among them.")}
      ${simple("You wait for a bus that comes every 10 to 20 minutes. You have already waited 15. You do not think \"10 to 20 more\": "
        + "you think \"at most 5 more\". Waiting gives information.")}
      ${steps("Step by step", [
        "Draw the curve \"share of incidents cleared after x minutes\" through the three points of the model (10%, 50%, 90%).",
        "Read the curve at the minutes already passed: that share of outcomes is ruled out. Example: if 25% would be cleared by now, 75% remain.",
        "The new 10% point is where the curve reaches 25% + 10% × 75%; the new median where it reaches 25% + 50% × 75%; the new 90% point where it reaches 25% + 90% × 75%.",
        "Subtract the minutes already passed: that gives the minutes <em>still to wait</em>.",
        "If less than 2% of outcomes remain, the incident is longer than almost anything we expected: the message says so honestly (\"taking longer than our estimate\").",
      ])}
      <div class="formula">P(cleared before x | not cleared after e)  =  ( F(x) - F(e) ) / ( 1 - F(e) )
new point for level p  =  F⁻¹( F(e) + p × (1 - F(e)) )  - e       (minutes still to wait)</div>
      ${liveHtml}
      ${expert("In probability this is <strong>conditioning</strong>. Implemented in <code>impact_engine.remaining_range()</code> and <code>delay_quantile()</code>. "
        + "The curve is piecewise linear through the three quantiles, with tails extended by 25% of the neighbouring gap down to 0% and up to 100%. "
        + "When less than 2% remains, we fall back to a generic 10-45 min remaining range and flag the overrun.")}`;
  },

  arrival(d) {
    const a = d.assumptions;
    const j = liveJourney();
    let liveHtml = noLive("Book a trip with a connection (Paris → Lyon, continue to Grenoble) and trigger an incident.");
    if (j && j.connection) {
      const sched = new Date(j.stops[j.stops.length - 1].scheduled);
      const dep = new Date(j.connection.departure);
      const slack = (dep - sched) / 60000 - j.connection.walk_min;
      const inc = state.incident;
      liveHtml = live(`Your train is due at <strong>${hhmm(sched)}</strong>. Your connection ${esc(j.connection.train)} leaves at <strong>${hhmm(dep)}</strong>.
        You need ${j.connection.walk_min} min to change trains. So you can afford <strong>${Math.round(slack)} min</strong> of delay
        (${hhmm(dep)} - ${hhmm(sched)} - ${j.connection.walk_min} min).
        ${inc ? `<br>Total delay estimate right now: ${Math.round(inc.total.low)} / ${Math.round(inc.total.median)} / ${Math.round(inc.total.high)} min (10% / 50% / 90%).
          ${tx("The chance that the delay stays under", "La chance que le retard reste sous")} ${Math.round(slack)} min ${tx("is read on the curve:", "se lit sur la courbe :")} <strong>${pct(inc.probability)}</strong>.
          ${cdfChart(inc.total, Math.max(0, slack), tx(`you can afford ${Math.round(slack)} min`, `vous pouvez supporter ${Math.round(slack)} min`))}` : `<br>${tx("Delay so far:", "Retard pour l'instant :")} ${Math.round(state.delayMin)} min.`}`);
    }
    return `
      <h2>9. Arrival & connection</h2>
      <p class="lead">Passengers do not care about "clearance time". They care about "when do I arrive?" and "will I make my connection?".</p>
      ${socrates("The track will be cleared in 45 to 124 minutes. You were due at 18:56. When do you arrive?",
        "Add the range to the timetable: between <strong>19:41</strong> (18:56 + 45) and <strong>21:00</strong> (18:56 + 124). "
        + "Plus any delay already lost earlier in the trip.")}
      ${steps("Arrival range", [
        "Total delay = delay already lost + minutes stopped so far + minutes still to wait (low, median, high).",
        "New arrival = scheduled arrival + total delay, for each of the three points.",
        "We assume the train does not catch up time after the incident (a cautious choice).",
      ])}
      ${steps("Chance to make the connection", [
        "Delay you can afford = connection departure - scheduled arrival - time to change trains.",
        "Chance = share of possible delays that are below that number, read on the curve.",
        "80% or more: <em>likely OK</em>. 50% to 80%: <em>at risk</em>. Under 50%: <em>unlikely</em>, and we suggest the next real TER you can still catch.",
      ])}
      ${liveHtml}
      ${warn(`Two assumptions: we book the first connecting TER leaving at least <strong>${a.booking_min_transfer} min</strong> after arrival, and changing trains takes
        <strong>${a.transfer_walk_min} min</strong>. SNCF's official minimum connection times are not in the open timetable (its <code>transfers.txt</code> file is empty; we checked).`)}
      ${expert("Code: <code>impact_engine.new_arrival_range()</code> and <code>connection_probability()</code>. The connecting trains and the suggested "
        + "alternatives are real TERs from the timetable (chapter 2). We do not model the domino effect of other trains on yours after the line reopens.")}`;
  },

  results(d) {
    const m = d.metrics, ps = d.passenger_sim;
    const done = state.log.filter((e) => e.actual !== null);
    return `
      <h2>10. Does it work? Results</h2>
      <p class="lead">We tested the model on ${m.n_test} incidents it had never seen, and compared it with the simple table (the baseline).</p>
      ${socrates("How would you prove that a range is honest, and not just wide?",
        "Two checks. (1) Hide some incidents from the model and see if <strong>about 80%</strong> of their real durations fall inside the 10%-90% range: that is <em>coverage</em>. "
        + "(2) Check the range is not uselessly wide, and that the middle estimate is close to the truth: <em>average error</em> and <em>width</em>.")}
      ${simple("<strong>Average error (MAE)</strong>: guesses 50 and 70 for truths 60 and 60 → errors 10 and 10 → MAE = 10 minutes. "
        + "<strong>Coverage</strong>: 10 incidents, 8 inside the range → 80%. "
        + "A range of \"0 to 24 hours\" would have 100% coverage and be useless: that is why we also look at the width.")}
      ${table(["Measure", "Baseline (table only)", "Our model", "What it means"], [
        ["Average error of the middle estimate", `${m.baseline.mae.toFixed(1)} min`, `<strong>${m.model.mae.toFixed(1)} min</strong>`, "Lower is better: the model's middle guess is much closer."],
        ["Coverage of the range", pct(m.baseline.coverage), `<strong>${pct(m.model.coverage)}</strong>`, "Target 80%. The model hits it exactly."],
        ["Average width of the range", `${Math.round(m.baseline.avg_width)} min`, `<strong>${Math.round(m.model.avg_width)} min</strong>`, "Narrower is more useful, as long as coverage holds."],
      ])}
      <h4>Does a range help passengers? (simulation of ${m.n_test} passengers)</h4>
      ${steps("How the passenger test works", [
        `Each of the ${m.n_test} test incidents happens to one passenger who has a connection.`,
        "Their margin before the connection is random, between 15 and 180 minutes.",
        `Each strategy decides: keep the connection, or rebook now. Missing a connection costs ${ps.miss_cost} minutes of harm; rebooking costs ${ps.rebook_cost}.`,
        `A, silence (today): always keeps it. B, one number: keeps it if the median fits. C, our range: keeps it only if the chance is at least ${pct(ps.stay_if_prob)}.`,
      ])}
      ${table(["Strategy", tx("Missed connections", "Correspondances manquées"), tx("Average cost (min)", "Coût moyen (min)")], Object.values(ps.results).map((r) => [esc(field(r, "label")), `<strong>${pct(r.missed_rate)}</strong>`, r.avg_cost.toFixed(1)]), [1, 2])}
      ${done.length ? live(`On your trips: ${done.filter((e) => e.inside).length} of ${done.length} incident(s) ended inside the first range we announced.
        One trip is just one example: a range can be right and still miss sometimes (about 1 time in 10 by design).`) : noLive("Finish a trip with an incident to compare.")}
      ${warn("These tests use synthetic incidents made with the same rules as the training data (chapter 5). They prove the method is sound, not that it would be as accurate on real SNCF incidents.")}
      ${expert("Code: <code>src/evaluate.py</code>. The test set is the same 20% as in training (same seed). The passenger simulation uses <code>random.Random(42)</code> for the margins.")}`;
  },

  messages(d) {
    const facts = state.facts;
    return `
      <h2>11. Messages & assistant</h2>
      <p class="lead">The model computes; the language model only phrases. It is never allowed to invent a number.</p>
      ${socrates("Should an AI chatbot decide how long the incident will last?",
        "No. Language models are good at sentences and bad at facts: they can confidently invent a time. So every number comes from our model "
        + "and is handed to the language model as a list of facts. Its instructions forbid any other number.")}
      ${steps("How a message is made", [
        "<strong>Push notification</strong>: a fixed template filled with our numbers (no AI): incident, clearance range, new arrival, connection verdict, suggested train.",
        "<strong>Assistant</strong>: your question + the current facts (below) are sent to the language model.",
        "Its rules: never invent a number, always give a range, at most 3 sentences, answer in your language, say \"I don't know yet\" if the facts don't cover it.",
        "If no API key or no network: a simple offline answer built from the same facts.",
      ])}
      ${facts ? live(`The facts the assistant can use right now:<div class="formula">${esc(JSON.stringify(facts, null, 2))}</div>`) : noLive("Board a train to see the facts.")}
      ${expert(`Provider: ${esc(d.llm.provider)}, model <code>${esc(d.llm.model)}</code>, temperature 0.2 (little randomness), via an OpenAI-compatible API (${esc(d.llm.base_url)}).
        Code: <code>src/narrator.py</code>. Tested: asked "will there be a replacement bus?" it answers "I don't know yet" because that is not in the facts.`)}`;
  },

  weather() {
    const j = liveJourney();
    return `
      <h2>12. Weather</h2>
      <p class="lead">The weather of your trip is simulated, not a real forecast.</p>
      ${simple("At booking, we draw the weather at random with the same odds as the training data (clear 62, rain 20, storm 8, heat 6, snow 4), "
        + "after removing what cannot happen in the season: no heatwave from November to March, no snow from May to September. "
        + "The temperature is only decoration.")}
      ${steps("Why weather matters", [
        "It is one of the model's inputs (chapter 6).",
        "In the synthetic data, storm or snow makes weather and infrastructure incidents last 25% longer (chapter 5).",
      ])}
      ${j ? live(`${tx("Your trip:", "Votre trajet :")} <strong>${t(j.weather)}</strong>, ${j.temperature_c}°C. ${tx("Odds used for", "Probabilités utilisées pour le")} ${esc(j.date)}:
        ${Object.entries(j.weather_odds).map(([k, v]) => `${t(k)} ${v}`).join(", ")}.`) : noLive(tx("Book a trip to see its weather.", "Réservez un trajet pour voir sa météo."))}
      ${expert("A next step would be real historical weather (Météo-France open data) for the date and place of each incident.")}`;
  },

  limits() {
    return `
      <h2>13. Limits & next steps</h2>
      <p class="lead">What this project proves, what it does not, and how to go further.</p>
      ${socrates("If the results are so good, why not deploy it tomorrow?",
        "Because the model learned from incidents <strong>we generated</strong>. It reproduces our rules faithfully; it has never seen a real SNCF incident. "
        + "Before using it for real, it must be trained and tested on real incidents.")}
      ${steps("Limits", [
        "Training data is synthetic (chapter 5). Only 4 of the 12 durations rest on official SNCF figures; 8 are estimates.",
        "The train's position assumes constant speed between stations; the urban and maintenance thresholds are assumptions (chapter 3).",
        "Only two reference days of the timetable are loaded, and three itineraries plus one connection.",
        "After the line reopens, the train is assumed not to catch up time, and other trains' delays (domino effect) are not simulated live.",
        "Weather is random, not real.",
        "The assistant depends on an external free service (Groq); without it, it falls back to simple sentences.",
      ])}
      ${steps("How to get real data (next step)", [
        "Record SNCF's free real-time feeds every few minutes for several weeks: GTFS-RT <em>Service Alerts</em> (incident start, cause, end) and <em>Trip Updates</em> (delays).",
        "Match alert start and end times to build a real log: cause, place, start, end, duration.",
        "Retrain the same pipeline on it, and compare with today's results.",
      ])}
      ${sources([
        ["https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts", "SNCF real-time alerts (GTFS-RT), free, no account needed."],
        ["https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates", "SNCF real-time delays (GTFS-RT)."],
      ])}`;
  },

  sources(d) {
    const src = d.timetable.source;
    const list = [
      [src.page, `Official SNCF timetable (GTFS), version ${src.feed_version}, valid ${src.valid_from} to ${src.valid_to}. Used for: every train, stop, time, coordinate, connection.`],
      ...d.timetable.days[0].itineraries.flatMap((i) => i.sources.map((s) => [s.url, `${s.title}. Used for: track layout.`])),
      ...[...new Map(d.rulebook.map((r) => [r.source_url, r])).values()].map((r) => [r.source_url, `Used for incident durations and descriptions (${d.rulebook.filter((x) => x.source_url === r.source_url).map((x) => x.label).join(", ")}).`]),
      [d.real_world.source_url, `Real delay statistics, ${d.real_world.period}, copied ${d.real_world.copied_on}.`],
      ["https://console.groq.com", `Free language model service (${d.llm.model}) for the assistant.`],
    ];
    return `
      <h2>14. All sources</h2>
      <p class="lead">Every external source used in this project, and what it was used for. Pages consulted on 2026-11-27.</p>
      ${sources(list)}
      ${expert("Files in the project that document the data: <code>docs/ITINERARIES.md</code> (every train), <code>data/incident_types.csv</code> "
        + "(durations with evidence and source), <code>data/network.csv</code> (training network), <code>src/generate_data.py</code> (all generation rules).")}`;
  },
};

// --- Panel ----------------------------------------------------------------------------------
async function openReport(chapter) {
  if (!REPORT.data) REPORT.data = await api("/api/report");
  REPORT.current = RENDER[chapter] ? chapter : "overview";
  $("report-toc").innerHTML = chapters().map(([id, title]) =>
    `<a data-goto="${id}" class="${id === REPORT.current ? "active" : ""}">${esc(title)}</a>`).join("");
  $("report-content").innerHTML = localizeReport(RENDER[REPORT.current](REPORT.data));
  $("report").classList.remove("hidden");
  document.querySelector(".report-body").scrollTop = 0;
}

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]");
  if (go) openReport(go.dataset.goto);
  if (e.target.id === "report-close" || e.target.id === "report") $("report").classList.add("hidden");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("report").classList.add("hidden");
});
