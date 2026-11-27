// Passenger simulation - browser side.
// The browser keeps the clock and animates; every number comes from the server.
//
// Time model (all in simulated minutes since our departure):
//   simMin     wall-clock time that has passed
//   delayMin   minutes lost to incidents that are already over
//   travelled  = simMin - delayMin - (minutes stopped in the current incident)
//              -> where the train is on its timetable

const SPEEDS = [1, 3, 6, 12];               // simulated minutes per real second
const RANDOM_RATE = { off: 0, rare: 0.5, frequent: 1.6 }; // expected incidents per journey
const UPDATE_EVERY_MIN = 15;

const state = {
  options: null,
  request: null,       // last booking, reused by "Ride again"
  journey: null,
  facts: null,         // what the assistant is allowed to talk about
  simMin: 0,
  delayMin: 0,
  incident: null,      // the active incident
  log: [],             // every incident of this trip, for the summary
  connectionMade: null,
  running: false,
  paused: false,
  busy: false,         // freezes the clock while the server answers
  speed: 6,
  randomMode: "rare",
  lastFrame: 0,
};

const $ = (id) => document.getElementById(id);

// --- Small helpers ------------------------------------------------------------
async function api(path, body) {
  if (state.backend === "browser" && path !== "/api/chat") return Engine.handle(path, body || {});
  const res = await fetch(path, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, lang: LANG }),
  });
  // Netlify has no Python server. A missing /api/options means: run the
  // simulation in the browser from bundle.json. Chat still goes to /api/chat.
  if (!res.ok && path === "/api/options") {
    state.backend = "browser";
    return Engine.handle(path, {});
  }
  if (res.ok && path === "/api/options") state.backend = "python";
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) { /* not JSON */ }
    throw new Error(detail);
  }
  return res.json();
}

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addMin = (d, m) => new Date(d.getTime() + m * 60000);
// Local ISO without timezone, the format the Python side uses.
const isoLocal = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm(d)}:${pad(d.getSeconds())}`;
function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(`screen-${name}`).classList.add("active");
}

const selectedDay = () => state.options.days.find((d) => d.date === $("day").value);
const selectedItinerary = () => selectedDay().itineraries.find((i) => i.id === $("itinerary").value);
const selectedTrain = () => selectedItinerary().trains.find((t) => t.id === $("train").value);

function fill(select, items, value, label) {
  select.innerHTML = "";
  items.forEach((x) => select.append(new Option(label(x), value(x))));
}

// --- Booking screen -------------------------------------------------------------
const locale = () => (LANG === "fr" ? "fr-FR" : "en-GB");
const dayLabel = (d) =>
  `${new Date(`${d.date}T12:00:00`).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${t(d.day_type)})`;
const typeName = (typeId) => {
  const type = state.options.incident_types.find((x) => x.type_id === typeId);
  return type ? (LANG === "fr" ? type.label_fr : type.label) : typeId;
};
// The incident name follows the current language, even if it started in the other one.
function incidentText(data) {
  const leg = state.journey && data.leg_index !== undefined ? state.journey.legs[data.leg_index] : null;
  return leg ? t("between", { type: typeName(data.type_id), a: leg.from_stop, b: leg.to_stop }) : data.label;
}

async function init() {
  state.options = await api("/api/options");
  $("assistant-mode").textContent = state.options.assistant === "groq" ? t("assistantLive") : t("assistantOff");

  fill($("day"), state.options.days, (d) => d.date, dayLabel);
  $("day").addEventListener("change", fillItineraries);
  $("itinerary").addEventListener("change", fillTrains);
  $("train").addEventListener("change", fillStops);
  $("origin").addEventListener("change", fillDestinations);
  $("destination").addEventListener("change", updateConnectionRow);

  fillWeather();
  fillSpeeds();
  fillIncidentTypes();

  fillItineraries();
  $("btn-book").addEventListener("click", book);
  $("btn-board").addEventListener("click", board);
  setupJourneyControls();
}

function fillWeather() {
  const current = $("weather").value || "random";
  $("weather").innerHTML = "";
  $("weather").append(new Option(t("weatherRandom"), "random"));
  state.options.weather.forEach((w) => $("weather").append(new Option(t(w), w)));
  $("weather").value = current;
}

function fillSpeeds() {
  const current = $("speed-initial").value || String(state.speed);
  $("speed-initial").innerHTML = "";
  SPEEDS.forEach((s) => $("speed-initial").append(new Option(t("minPerSec", { s }), s)));
  $("speed-initial").value = current;
}

function fillIncidentTypes() {
  const current = $("incident-type").value;
  $("incident-type").innerHTML = "";
  state.options.incident_types.forEach((type) =>
    $("incident-type").append(new Option(LANG === "fr" ? type.label_fr : type.label, type.type_id)));
  $("incident-type").prepend(new Option(t("randomType"), ""));
  $("incident-type").value = [...$("incident-type").options].some((o) => o.value === current) ? current : "";
}

function fillItineraries() {
  fill($("itinerary"), selectedDay().itineraries, (i) => i.id,
    (i) => `${LANG === "fr" && i.label_fr ? i.label_fr : i.label} - ${i.trains.length} ${t("trains")}`);
  fillTrains();
}

function fillTrains() {
  fill($("train"), selectedItinerary().trains, (train) => train.id, (train) => {
    const s = train.stops;
    const middle = s.length > 2 ? `${s.length - 2} ${t(s.length > 3 ? "stops" : "stop")}` : t("nonstop");
    return `${s[0].departure} → ${s[s.length - 1].arrival}  ${train.id}  (${middle})`;
  });
  fillStops();
}

function fillStops() {
  const stops = selectedTrain().stops;
  fill($("origin"), stops.slice(0, -1), (s) => s.uic, (s) => `${s.name} (${s.departure})`);
  fillDestinations();
}

function fillDestinations() {
  const stops = selectedTrain().stops;
  const from = stops.findIndex((s) => s.uic === $("origin").value);
  fill($("destination"), stops.slice(from + 1), (s) => s.uic, (s) => `${s.name} (${s.arrival})`);
  $("destination").value = stops[stops.length - 1].uic;
  updateConnectionRow();
}

function updateConnectionRow() {
  const offer = selectedItinerary().connection;
  const show = Boolean(offer) && offer.station === $("destination").value;
  $("connection-row").classList.toggle("hidden", !show);
  $("with-connection").checked = show;
  if (show) $("connection-label").textContent = t("continueTo", { to: offer.to_name });
  $("ticket").classList.add("hidden");
}

async function book() {
  const connectionVisible = !$("connection-row").classList.contains("hidden");
  state.request = {
    date: $("day").value,
    itinerary_id: $("itinerary").value,
    train_id: $("train").value,
    origin: $("origin").value,
    destination: $("destination").value,
    weather: $("weather").value,
    with_connection: connectionVisible && $("with-connection").checked,
  };
  try {
    state.journey = await api("/api/journey", state.request);
  } catch (err) {
    alert(err.message);
    return;
  }
  renderTicket();
}

function renderTicket() {
  const j = state.journey;
  const dep = new Date(j.stops[0].scheduled);
  const arr = new Date(j.stops[j.stops.length - 1].scheduled);
  const total = j.stops[j.stops.length - 1].offset_min;
  $("t-train").textContent = j.train;
  $("t-date").textContent = dep.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
  $("t-dep").textContent = hhmm(dep);
  $("t-arr").textContent = hhmm(arr);
  $("t-from").textContent = j.origin;
  $("t-to").textContent = j.destination;
  $("t-duration").textContent = `${Math.floor(total / 60)}h${pad(total % 60)}`;
  const middle = j.stops.slice(1, -1).map((s) => `${s.name} ${hhmm(new Date(s.scheduled))}`);
  $("t-stops").textContent = middle.length ? t("stopsList", { list: middle.join(", ") }) : t("direct");
  $("t-connection").textContent = j.connection
    ? t("thenConnection", { train: j.connection.train, to: j.connection.to, time: hhmm(new Date(j.connection.departure)) })
    : t("direct");
  $("ticket").classList.remove("hidden");
}

// --- Boarding animation -----------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function board() {
  const j = state.journey;
  state.speed = Number($("speed-initial").value);
  state.randomMode = $("incident-mode").value;
  showScreen("boarding");

  const train = $("boarding-train");
  const passenger = $("passenger");
  train.classList.remove("arrive", "open");
  passenger.classList.remove("walk", "inside");
  $("boarding-sign").textContent = `${hhmm(new Date(j.stops[0].scheduled))}  ${j.train}  to ${j.destination}`;
  $("boarding-caption").textContent = t("arriving", { station: j.origin });
  void train.getBoundingClientRect(); // restart the CSS transitions

  await wait(80);
  train.classList.add("arrive");
  await wait(1900);
  $("boarding-caption").textContent = t("doorsOpening");
  train.classList.add("open");
  await wait(700);
  $("boarding-caption").textContent = t("boarding");
  passenger.classList.add("walk");
  await wait(1400);
  passenger.classList.add("inside");
  await wait(500);
  train.classList.remove("open");
  $("boarding-caption").textContent = t("doorsClosing");
  await wait(900);
  startJourney();
}

// --- Journey ------------------------------------------------------------------------
function startJourney() {
  const j = state.journey;
  Object.assign(state, {
    simMin: 0, delayMin: 0, incident: null, log: [], connectionMade: null, rebooked: null,
    running: true, paused: false, busy: false, facts: j.facts,
  });
  $("tab-feed").innerHTML = "";
  $("tab-chat").innerHTML = "";
  addBubble("hint", t("askHint"));
  $("incident-mode-live").value = state.randomMode;
  $("btn-pause").textContent = t("pause");
  $("btn-incident").disabled = false;
  $("summary").classList.add("hidden");
  renderSpeedButtons();

  $("j-train").textContent = j.train;
  $("j-route").textContent = t("toDestination", { from: j.origin, to: j.destination });
  $("j-weather").textContent = `${t(j.weather)}, ${j.temperature_c}°C`;
  $("d-connection-row").classList.toggle("hidden", !j.connection);
  $("d-meter").classList.toggle("hidden", !j.connection);
  buildMap();
  showScreen("journey");

  setTimeout(() => notify(t("welcome"), j.welcome_message, "plain", { toast: true, speak: true }), 400);
  state.lastFrame = performance.now();
}

const journeyLength = () => state.journey.stops[state.journey.stops.length - 1].offset_min;
const stoppedFor = () => (state.incident ? state.simMin - state.incident.startSim : 0);
const travelled = () => state.simMin - state.delayMin - stoppedFor();
const departureTime = () => new Date(state.journey.stops[0].scheduled);
const nowTime = () => addMin(departureTime(), state.simMin);

// Which leg the train is on, and how far along it (0 = just left, 1 = arriving).
function currentLeg() {
  const progress = travelled();
  const stops = state.journey.stops;
  let i = stops.findIndex((s, k) => k < stops.length - 1 && progress < stops[k + 1].offset_min);
  if (i < 0) i = stops.length - 2;
  const span = stops[i + 1].offset_min - stops[i].offset_min;
  return { index: i, fraction: span > 0 ? Math.min(1, Math.max(0, (progress - stops[i].offset_min) / span)) : 0.5 };
}

function step(now = performance.now()) {
  const dt = Math.min((now - state.lastFrame) / 1000, 1);
  state.lastFrame = now;
  if (state.running && !state.paused && !state.busy) advance(dt * state.speed);
  if (state.journey && $("screen-journey").classList.contains("active")) render();
}

function frame(now) {
  step(now);
  requestAnimationFrame(frame);
}

// Browsers slow down animation frames in hidden or embedded tabs: keep the clock going anyway.
setInterval(() => {
  if (performance.now() - state.lastFrame > 120) step();
}, 100);

function advance(minutes) {
  if (state.incident) {
    const inc = state.incident;
    const end = inc.startSim + inc.data.true_minutes;
    const nextUpdateAt = inc.startSim + inc.nextUpdate;
    const target = state.simMin + minutes;
    // Stop the clock exactly on the update time, so updates come every 15 minutes even if frames are slow.
    if (target >= nextUpdateAt && nextUpdateAt < end) {
      state.simMin = nextUpdateAt;
      inc.nextUpdate += UPDATE_EVERY_MIN;
      updateIncident();
      return;
    }
    if (target >= end) {
      state.simMin = end;
      resolveIncident();
      return;
    }
    state.simMin = target;
    return;
  }

  const before = travelled();
  state.simMin += minutes;
  const after = travelled();
  const length = journeyLength();

  for (const stop of state.journey.stops.slice(1)) {
    if (before < stop.offset_min && after >= stop.offset_min) {
      if (stop.offset_min === length) {
        state.simMin -= after - length;
        arrive();
        return;
      }
      notify(t("station"), t("arrivingAt", { station: stop.name }), "plain");
    }
  }

  // Random incidents: one dice roll per simulated minute, never right at the start or end.
  const perMinute = RANDOM_RATE[state.randomMode] / length;
  for (let m = Math.floor(before) + 1; m <= Math.floor(after); m++) {
    if (m > 3 && m < length - 3 && Math.random() < perMinute) {
      startIncident(null);
      return;
    }
  }
}

// --- Incidents ------------------------------------------------------------------------
async function startIncident(typeId) {
  if (state.incident || !state.running || state.busy) return;
  state.busy = true;
  try {
    const leg = currentLeg();
    const res = await api("/api/incident", {
      journey: state.journey,
      leg_index: leg.index,
      leg_fraction: leg.fraction,
      sim_time: isoLocal(nowTime()),
      type_id: typeId || null,
      prior_delay_min: state.delayMin,
    });
    state.incident = {
      data: res.incident,
      startSim: state.simMin,
      nextUpdate: UPDATE_EVERY_MIN,
      remaining: res.remaining,
      total: res.total_delay,
      arrival: res.arrival,
      probability: res.connection_probability,
      priorDelay: state.delayMin,
      history: [{ elapsed: 0, ...res.remaining }],
    };
    state.facts = res.facts;
    state.log.push({ first: res.incident.prediction, actual: null, data: res.incident });
    notify(t("incident"), res.message, "danger", { toast: true, speak: true });
  } catch (err) {
    notify(t("error"), err.message, "warning");
  } finally {
    state.busy = false;
  }
}

async function updateIncident() {
  const inc = state.incident;
  state.busy = true;
  try {
    const res = await api("/api/incident/update", {
      journey: state.journey,
      incident: inc.data,
      elapsed_min: stoppedFor(),
      prior_delay_min: state.delayMin,
      sim_time: isoLocal(nowTime()),
    });
    Object.assign(inc, { remaining: res.remaining, total: res.total_delay, arrival: res.arrival,
      probability: res.connection_probability });
    inc.history.push({ elapsed: Math.round(stoppedFor()), ...res.remaining });
    state.facts = res.facts;
    notify(t("update"), res.message, res.remaining.overrun ? "danger" : "warning", { speak: res.remaining.overrun });
  } catch (err) {
    notify(t("error"), err.message, "warning");
  } finally {
    state.busy = false;
  }
}

async function resolveIncident() {
  const inc = state.incident;
  const total = state.delayMin + inc.data.true_minutes;
  state.busy = true;
  try {
    const res = await api("/api/incident/resolve", {
      journey: state.journey,
      incident: inc.data,
      total_delay_min: total,
      sim_time: isoLocal(nowTime()),
    });
    const entry = state.log[state.log.length - 1];
    entry.actual = inc.data.true_minutes;
    entry.inside = res.estimate_was_right;
    entry.history = inc.history;
    if (res.rebooked) state.rebooked = res.rebooked;
    state.facts = res.facts;
    notify(t("resumed"), res.message, "success", { toast: true, speak: true });
  } catch (err) {
    notify(t("error"), err.message, "warning");
  } finally {
    state.delayMin = total;
    state.incident = null;
    state.busy = false;
  }
}

// --- Arrival + summary -------------------------------------------------------------------
function arrive() {
  state.running = false;
  $("btn-incident").disabled = true;
  const j = state.journey;
  const scheduled = new Date(j.stops[j.stops.length - 1].scheduled);
  const actual = addMin(scheduled, state.delayMin);
  let text = t("arrivedAt", { station: j.destination, time: hhmm(actual) });
  if (j.connection) {
    const dep = new Date(j.connection.departure);
    state.connectionMade = addMin(actual, j.connection.walk_min) <= dep;
    text += state.connectionMade
      ? t("connectionKept", { train: j.connection.train, to: j.connection.to, time: hhmm(dep) })
      : t("connectionMissed", { time: hhmm(dep), next: nextConnectionText() });
  }
  notify(t("arrived"), text, "success", { toast: true, speak: true });
  setTimeout(showSummary, 1500);
}

// The first real connecting train the passenger can still catch after arriving.
function nextConnectionText() {
  const c = state.journey.connection;
  const arrival = addMin(new Date(state.journey.stops[state.journey.stops.length - 1].scheduled), state.delayMin);
  const next = c.alternatives.find((a) => addMin(arrival, c.walk_min) <= new Date(a.departure));
  return next
    ? t("nextTrain", { train: next.train, time: hhmm(new Date(next.departure)) })
    : t("noLaterTrain", { to: c.to });
}

function showSummary() {
  const j = state.journey;
  const scheduled = new Date(j.stops[j.stops.length - 1].scheduled);
  const actual = addMin(scheduled, state.delayMin);
  const delay = Math.round(state.delayMin);
  const done = state.log.filter((e) => e.actual !== null);
  const inside = done.filter((e) => e.inside).length;

  const rows = done.map((e) => `
    <tr><td>${incidentText(e.data)}</td><td>${e.first.low}-${e.first.high} min</td><td>${e.actual} min</td>
    <td class="${e.inside ? "good" : "bad"}">${e.inside ? t("inside") : t("outside")}</td></tr>`).join("");

  let connection = "";
  if (j.connection) {
    connection = state.connectionMade
      ? `<p class="good">${t("connectionMade", { to: j.connection.to })}</p>`
      : `<p class="bad">${t("connectionMissedSummary", { to: j.connection.to, next: nextConnectionText() })}</p>`;
  }

  $("summary-body").innerHTML = `
    <h2>${t("journeyComplete")}</h2>
    <div class="stats">
      <div class="stat"><span>${t("scheduled")}</span><strong>${hhmm(scheduled)}</strong></div>
      <div class="stat"><span>${t("actual")}</span><strong>${hhmm(actual)}</strong></div>
      <div class="stat"><span>${t("delay")}</span><strong>${delay ? `+${delay} min` : t("onTime")}</strong></div>
    </div>
    ${done.length ? `
      <table><thead><tr><th>${t("colIncident")}</th><th>${t("colRange")}</th><th>${t("colDuration")}</th><th>${t("colTruth")}</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p>${t("score", { inside, total: done.length })}</p>
      <div class="compare">
        <div class="today"><strong>${t("today")}</strong><br>${t("todayText")}</div>
        <div class="ours"><strong>${t("ours")}</strong><br>${t("oursText", { min: UPDATE_EVERY_MIN })}</div>
      </div>` : `<p>${t("quiet")}</p>`}
    ${connection}
    <div class="modal-actions">
      <button class="primary" id="btn-again">${t("rideAgain")}</button>
      <button id="btn-explain">${t("explain")}</button>
      <button id="btn-new">${t("newTrip")}</button>
    </div>`;
  $("toast").classList.add("hidden");
  $("summary").classList.remove("hidden");
  $("btn-again").addEventListener("click", rideAgain);
  $("btn-explain").addEventListener("click", () => openReport(done.length ? "model" : "overview"));
  $("btn-new").addEventListener("click", () => {
    $("summary").classList.add("hidden");
    $("ticket").classList.add("hidden");
    showScreen("booking");
  });
}

async function rideAgain() {
  $("summary").classList.add("hidden");
  state.journey = await api("/api/journey", state.request);
  board();
}

// --- Rendering ---------------------------------------------------------------------------
const MAP = { x0: 90, x1: 910, y: 130 };
const mapX = (offset) => MAP.x0 + (MAP.x1 - MAP.x0) * (offset / journeyLength());
const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (parent) parent.append(el);
  return el;
}

function buildMap() {
  const map = $("route-map");
  map.innerHTML = "";
  const { x0, x1, y } = MAP;
  svg("line", { x1: x0, y1: y, x2: x1, y2: y, class: "map-track" }, map);
  svg("line", { x1: x0, y1: y, x2: x0, y2: y, class: "map-done", id: "map-done" }, map);

  const stops = state.journey.stops;
  const crowded = stops.length > 2;  // intermediate stops: tilted names so they do not overlap
  const NAME_GAP = 24, TIME_GAP = 42;  // px; closer labels would overlap, the dot keeps a tooltip
  let lastName = -Infinity, lastTime = -Infinity;
  stops.forEach((s, i) => {
    const x = mapX(s.offset_min);
    const isLast = i === stops.length - 1;
    const dot = svg("circle", { cx: x, cy: y, r: 8, class: "map-station", id: `map-st-${i}` }, map);
    svg("title", {}, dot).textContent = `${s.name} - ${hhmm(new Date(s.scheduled))}`;
    if (isLast || x - lastTime >= TIME_GAP) {
      const time = svg("text", { x, y: y + 32, class: "map-time", "text-anchor": "middle" }, map);
      time.textContent = hhmm(new Date(s.scheduled));
      lastTime = x;
    }
    if (!isLast && x - lastName < NAME_GAP) return;
    lastName = x;
    if (crowded) {
      const name = svg("text", { x: x + 4, y: y - 18, class: "map-name", transform: `rotate(-32 ${x + 4} ${y - 18})` }, map);
      name.textContent = s.name;
    } else {
      const anchor = i === 0 ? "start" : i === stops.length - 1 ? "end" : "middle";
      const dx = i === 0 ? -8 : i === stops.length - 1 ? 8 : 0;
      const name = svg("text", { x: x + dx, y: y - 26, class: "map-name", "text-anchor": anchor }, map);
      name.textContent = s.name;
    }
  });

  svg("circle", { cx: 0, cy: 0, r: 16, class: "map-alert hidden", id: "map-alert" }, map);
  const train = svg("g", { class: "map-train", id: "map-train" }, map);
  svg("rect", { x: -20, y: -11, width: 40, height: 22, rx: 10, class: "body" }, train);
  svg("rect", { x: 4, y: -6, width: 10, height: 7, rx: 2, fill: "#fff" }, train);
}

function render() {
  const j = state.journey;
  const progress = Math.max(0, Math.min(travelled(), journeyLength()));
  const x = mapX(progress);
  const now = nowTime();
  const inc = state.incident;

  $("j-clock").textContent = hhmm(now);
  $("map-done").setAttribute("x2", x);
  $("map-train").setAttribute("transform", `translate(${x}, ${MAP.y})`);
  $("map-train").classList.toggle("stopped", Boolean(inc));
  const alert = $("map-alert");
  alert.classList.toggle("hidden", !inc);
  alert.setAttribute("cx", x);
  alert.setAttribute("cy", MAP.y);
  j.stops.forEach((s, i) => $(`map-st-${i}`).classList.toggle("passed", s.offset_min <= progress));

  const status = $("j-status");
  if (inc) {
    status.textContent = t("stoppedFor", { min: Math.round(stoppedFor()) });
    status.className = "chip status stopped";
  } else if (state.delayMin >= 1) {
    status.textContent = `+${Math.round(state.delayMin)} min`;
    status.className = "chip status late";
  } else {
    status.textContent = state.running ? t("onTime") : t("arrivedStatus");
    status.className = "chip status ok";
  }

  const next = j.stops.find((s) => s.offset_min > progress) || j.stops[j.stops.length - 1];
  const final = new Date(j.stops[j.stops.length - 1].scheduled);
  const nextScheduled = new Date(next.scheduled);
  $("d-next").textContent = next.name;
  $("d-scheduled").textContent = hhmm(final);

  if (inc) {
    const a = inc.arrival;
    const median = state.delayMin + stoppedFor() + inc.remaining.median;
    $("d-next").textContent = `${next.name} (${t("about")} ${hhmm(addMin(nextScheduled, median))})`;
    $("d-estimated").textContent =
      `${hhmm(new Date(a.earliest))} - ${hhmm(new Date(a.latest))} (${t("likely")} ${hhmm(new Date(a.expected))})`;
    $("d-incident").classList.remove("hidden");
    $("d-incident-why").classList.remove("hidden");
    $("d-incident").textContent = t("stoppedSentence", {
      label: incidentText(inc.data), min: Math.round(stoppedFor()),
      low: inc.remaining.low, high: inc.remaining.high,
    });
  } else {
    $("d-next").textContent = `${next.name} (${hhmm(addMin(nextScheduled, state.delayMin))})`;
    $("d-estimated").textContent = hhmm(addMin(final, state.delayMin));
    $("d-incident").classList.add("hidden");
    $("d-incident-why").classList.toggle("hidden", !state.log.length);
  }

  if (j.connection) renderConnection(final);
  $("btn-incident").disabled = Boolean(inc) || !state.running || state.busy;
}

function renderConnection(finalScheduled) {
  const c = state.journey.connection;
  const dep = new Date(c.departure);
  let p;
  if (state.incident && state.incident.probability !== null) {
    p = state.incident.probability;
  } else {
    p = addMin(finalScheduled, state.delayMin + c.walk_min) <= dep ? 1 : 0;
  }
  const verdict = p >= 0.8 ? t("likelyOk") : p >= 0.5 ? t("atRisk") : t("unlikely");
  $("d-connection").textContent = `${c.train} ${hhmm(dep)}: ${verdict} (${Math.round(p * 100)}%)`;
  const fill = $("d-meter-fill");
  fill.style.width = `${Math.max(3, p * 100)}%`;
  fill.style.background = p >= 0.8 ? "var(--green)" : p >= 0.5 ? "var(--amber)" : "var(--red)";
}

// --- Phone: notifications, assistant, voice ------------------------------------------------
function notify(title, text, kind, { toast = false, speak = false } = {}) {
  const note = document.createElement("div");
  note.className = `note ${kind}`;
  note.innerHTML = `<div class="meta"></div><div class="text"></div>`;
  note.querySelector(".meta").textContent = `${title} - ${state.journey ? hhmm(nowTime()) : ""}`;
  note.querySelector(".text").textContent = text;
  const feed = $("tab-feed");
  feed.append(note);
  feed.scrollTop = feed.scrollHeight;

  if (toast) {
    const t = $("toast");
    t.className = `toast ${kind === "plain" ? "" : kind}`;
    $("toast-title").textContent = title;
    $("toast-text").textContent = text;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => t.classList.add("hidden"), 6000);
  }
  if (speak && $("audio").checked && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG === "fr" ? "fr-FR" : "en-GB";
    window.speechSynthesis.speak(u);
  }
}

function addBubble(kind, text) {
  const b = document.createElement("div");
  b.className = `bubble ${kind}`;
  b.textContent = text;
  const chat = $("tab-chat");
  chat.append(b);
  chat.scrollTop = chat.scrollHeight;
  return b;
}

async function sendChat(event) {
  event.preventDefault();
  const input = $("chat-input");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  addBubble("user", question);
  const pending = addBubble("bot", "...");

  const progress = Math.min(travelled(), journeyLength());
  const next = state.journey.stops.find((s) => s.offset_min > progress);
  const facts = {
    ...state.facts,
    current_time: hhmm(nowTime()),
    next_stop: next ? next.name : state.journey.destination,
    minutes_late_so_far: Math.round(state.delayMin + stoppedFor()),
  };
  try {
    const { answer } = await api("/api/chat", { question, facts });
    // The language model sometimes uses **bold**: escape everything, then allow only that.
    pending.textContent = answer;
    pending.innerHTML = pending.innerHTML.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  } catch (err) {
    // A dropped Netlify folder has no chatbot function. Answer from the facts instead.
    pending.textContent = facts.summary
      ? t("chatOffline", { summary: facts.summary })
      : t("chatFail", { error: err.message });
  }
}

function renderSpeedButtons() {
  const box = $("speed-buttons");
  box.innerHTML = "";
  SPEEDS.forEach((s) => {
    const b = document.createElement("button");
    b.textContent = `x${s}`;
    b.title = t("speedTitle", { s });
    b.classList.toggle("active", s === state.speed);
    b.addEventListener("click", () => { state.speed = s; renderSpeedButtons(); });
    box.append(b);
  });
}

function setupJourneyControls() {
  $("btn-pause").addEventListener("click", () => {
    state.paused = !state.paused;
    $("btn-pause").textContent = state.paused ? t("resume") : t("pause");
  });
  $("btn-incident").addEventListener("click", () => startIncident($("incident-type").value));
  $("incident-mode-live").addEventListener("change", (e) => { state.randomMode = e.target.value; });
  $("chat-form").addEventListener("submit", sendChat);
  $("btn-report").addEventListener("click", () => openReport("overview"));
  document.addEventListener("click", (e) => {
    const why = e.target.closest(".why");
    if (why) openReport(why.dataset.chapter);
  });
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    const chat = tab.dataset.tab === "chat";
    $("tab-feed").classList.toggle("hidden", chat);
    $("tab-chat").classList.toggle("hidden", !chat);
    $("chat-form").classList.toggle("hidden", !chat);
  }));
}

init().then(() => requestAnimationFrame(frame)).catch((err) => {
  document.body.innerHTML = `<p style="padding:24px">${t("serverDown", { error: err.message })}</p>`;
});

// Called by the language switch: rebuild every label from the current language.
function onLanguageChange() {
  if (!state.options) return;
  $("assistant-mode").textContent = state.options.assistant === "groq" ? t("assistantLive") : t("assistantOff");
  const chosen = {
    day: $("day").value, itinerary: $("itinerary").value, train: $("train").value,
    origin: $("origin").value, destination: $("destination").value,
    ticket: !$("ticket").classList.contains("hidden"),
  };
  fill($("day"), state.options.days, (d) => d.date, dayLabel);
  $("day").value = chosen.day;
  fillItineraries();
  $("itinerary").value = chosen.itinerary;
  fillTrains();
  $("train").value = chosen.train;
  fillStops();
  $("origin").value = chosen.origin;
  fillDestinations();
  $("destination").value = chosen.destination;
  updateConnectionRow();
  fillWeather();
  fillSpeeds();
  fillIncidentTypes();
  if (chosen.ticket && state.journey) renderTicket();
  if (state.journey && $("screen-journey").classList.contains("active")) {
    const j = state.journey;
    $("j-route").textContent = t("toDestination", { from: j.origin, to: j.destination });
    $("j-weather").textContent = `${t(j.weather)}, ${j.temperature_c}°C`;
    $("btn-pause").textContent = state.paused ? t("resume") : t("pause");
    renderSpeedButtons();
    const hint = $("tab-chat").querySelector(".bubble.hint");
    if (hint) hint.textContent = t("askHint");
    render();
  }
  if (!$("summary").classList.contains("hidden")) showSummary();
  if (typeof openReport === "function" && !$("report").classList.contains("hidden")) openReport(REPORT.current);
}
