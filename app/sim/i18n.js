// Interface language. French by default (the project is about SNCF); the header
// switch stores the choice. Every visible sentence lives in STRINGS below.
let LANG = localStorage.getItem("manuella-lang") || "fr";

const STRINGS = {
  en: {
    brand: "passenger simulation",
    assistantLive: "Assistant: live language model (Groq)",
    assistantOff: "Assistant: offline templates (no API key)",
    reportBtn: "Report: how it works",
    whereGoing: "Where are you going?",
    hint: "Every train below is a real SNCF train from the official timetable.",
    whereFrom: "Where does this come from?",
    day: "Day", itinerary: "Itinerary", train: "Train", from: "From", to: "To",
    weekday: "weekday", weekend: "weekend",
    trains: "trains", nonstop: "nonstop", stop: "stop", stops: "stops",
    continueTo: "I continue to {to} with a real TER (first one leaving at least 15 min after arrival)",
    settings: "Simulation settings", weather: "Weather",
    weatherRandom: "Random (realistic odds for the season)",
    clear: "clear", rain: "rain", storm: "storm", heat: "heat", snow: "snow",
    randomIncidents: "Random incidents",
    incOff: "Off (only when I trigger one)", incRare: "Rare", incFrequent: "Frequent", incOffShort: "Off",
    speed: "Speed", minPerSec: "{s} min / second",
    getTicket: "Get my ticket",
    stopsList: "Stops: {list}", direct: "Direct journey",
    thenConnection: "Then {train} to {to} at {time}",
    board: "Board the train",
    arriving: "Your train is arriving at {station}...",
    doorsOpening: "Doors opening", boarding: "Boarding...",
    doorsClosing: "Doors closing. Have a good trip!",
    askHint: "Ask me anything about your journey: arrival time, connection, weather...",
    pause: "Pause", resume: "Resume",
    toDestination: "{from} to {to}",
    welcome: "Welcome aboard", station: "Station",
    arrivingAt: "Arriving at {station}.",
    incident: "Incident", update: "Update", error: "Error",
    resumed: "Traffic resumed", arrived: "Arrived",
    arrivedAt: "We have arrived at {station} at {time}.",
    connectionKept: " Your {train} to {to} leaves at {time}.",
    connectionMissed: " Your {time} connection has left; {next}.",
    nextTrain: "the next one is {train} at {time}",
    noLaterTrain: "there is no later train to {to} today",
    connectionMade: "Connection to {to} made.",
    connectionMissedSummary: "Connection to {to} missed: {next}.",
    journeyComplete: "Journey complete",
    scheduled: "Scheduled", actual: "Actual", delay: "Delay", onTime: "On time",
    stoppedFor: "Stopped {min} min", late: "+{min} min", arrivedStatus: "Arrived",
    colIncident: "Incident", colRange: "Our first range", colDuration: "Real duration", colTruth: "Truth",
    inside: "inside", outside: "outside",
    score: "{inside} of {total} incident(s) ended inside the range we announced at the very first minute. The model aims for about 8 out of 10, which is what an honest 10%-90% range means.",
    today: "Today",
    todayText: "\"Traffic interrupted, resumption time undetermined\", repeated until it ends.",
    ours: "With our system",
    oursText: "A range from the first minute, re-computed every {min} minutes, with the risk to your connection.",
    quiet: "A quiet trip: no incident this time. Try triggering one, or set random incidents to frequent.",
    rideAgain: "Ride again", explain: "Explain this trip", newTrip: "New trip",
    onboard: "Onboard display", nextStop: "Next stop", scheduledArrival: "Scheduled arrival",
    estimatedArrival: "Estimated arrival", connection: "Connection",
    whereExactly: "Where exactly?", whyRange: "Why this range?",
    whatModel: "What did the model see?", whyChange: "Why does it change?",
    controls: "Controls", incidentType: "Incident type", randomType: "Random type",
    trigger: "Trigger an incident", spoken: "Spoken announcements",
    notifications: "Notifications", assistant: "Assistant",
    askPlaceholder: "Ask about your journey", send: "Send",
    likelyOk: "likely OK", atRisk: "at risk", unlikely: "unlikely",
    about: "about", likely: "likely",
    stoppedSentence: "{label}. Stopped for {min} min. Estimated {low}-{high} more minutes.",
    chatFail: "Sorry, I could not answer ({error}).",
    chatOffline: "Here is what we know right now: {summary}",
    speedTitle: "{s} simulated minute(s) per second",
    serverDown: "Could not reach the simulation server: {error}",
    between: "{type} between {a} and {b}",
    reportTitle: "Report", close: "Close",
  },
  fr: {
    brand: "simulation voyageur",
    assistantLive: "Assistant : modèle de langage en direct (Groq)",
    assistantOff: "Assistant : modèles hors ligne (pas de clé API)",
    reportBtn: "Rapport : comment ça marche",
    whereGoing: "Où allez-vous ?",
    hint: "Chaque train ci-dessous est un vrai train SNCF, issu de l'horaire officiel.",
    whereFrom: "D'où vient ceci ?",
    day: "Jour", itinerary: "Itinéraire", train: "Train", from: "De", to: "À",
    weekday: "semaine", weekend: "week-end",
    trains: "trains", nonstop: "direct", stop: "arrêt", stops: "arrêts",
    continueTo: "Je continue vers {to} avec un vrai TER (le premier qui part au moins 15 min après l'arrivée)",
    settings: "Réglages de la simulation", weather: "Météo",
    weatherRandom: "Aléatoire (probabilités réalistes pour la saison)",
    clear: "dégagé", rain: "pluie", storm: "tempête", heat: "canicule", snow: "neige",
    randomIncidents: "Incidents aléatoires",
    incOff: "Désactivés (seulement si j'en déclenche un)", incRare: "Rares", incFrequent: "Fréquents",
    incOffShort: "Désactivés",
    speed: "Vitesse", minPerSec: "{s} min / seconde",
    getTicket: "Obtenir mon billet",
    stopsList: "Arrêts : {list}", direct: "Trajet direct",
    thenConnection: "Puis {train} vers {to} à {time}",
    board: "Monter dans le train",
    arriving: "Votre train arrive à {station}...",
    doorsOpening: "Ouverture des portes", boarding: "Montée à bord...",
    doorsClosing: "Fermeture des portes. Bon voyage !",
    askHint: "Posez-moi une question sur votre trajet : arrivée, correspondance, météo...",
    pause: "Pause", resume: "Reprendre",
    toDestination: "{from} vers {to}",
    welcome: "Bienvenue à bord", station: "Gare",
    arrivingAt: "Arrivée à {station}.",
    incident: "Incident", update: "Mise à jour", error: "Erreur",
    resumed: "Trafic repris", arrived: "Arrivé",
    arrivedAt: "Nous sommes arrivés à {station} à {time}.",
    connectionKept: " Votre {train} vers {to} part à {time}.",
    connectionMissed: " Votre correspondance de {time} est partie ; {next}.",
    nextTrain: "le suivant est le {train} à {time}",
    noLaterTrain: "il n'y a plus de train pour {to} aujourd'hui",
    connectionMade: "Correspondance pour {to} assurée.",
    connectionMissedSummary: "Correspondance pour {to} manquée : {next}.",
    journeyComplete: "Trajet terminé",
    scheduled: "Prévu", actual: "Réel", delay: "Retard", onTime: "À l'heure",
    stoppedFor: "À l'arrêt depuis {min} min", late: "+{min} min", arrivedStatus: "Arrivé",
    colIncident: "Incident", colRange: "Notre première fourchette", colDuration: "Durée réelle", colTruth: "Verdict",
    inside: "dans la fourchette", outside: "en dehors",
    score: "{inside} incident(s) sur {total} se sont terminés dans la fourchette annoncée dès la première minute. Le modèle vise environ 8 fois sur 10, ce que signifie une fourchette honnête de 10 % à 90 %.",
    today: "Aujourd'hui",
    todayText: "« Trafic interrompu, reprise estimée indéterminée », répété jusqu'à la fin.",
    ours: "Avec notre système",
    oursText: "Une fourchette dès la première minute, recalculée toutes les {min} minutes, avec le risque pour votre correspondance.",
    quiet: "Un trajet tranquille : aucun incident cette fois. Déclenchez-en un, ou passez les incidents aléatoires sur « fréquents ».",
    rideAgain: "Refaire le trajet", explain: "Expliquer ce trajet", newTrip: "Nouveau trajet",
    onboard: "Écran de bord", nextStop: "Prochain arrêt", scheduledArrival: "Arrivée prévue",
    estimatedArrival: "Arrivée estimée", connection: "Correspondance",
    whereExactly: "Où exactement ?", whyRange: "Pourquoi cette fourchette ?",
    whatModel: "Qu'a vu le modèle ?", whyChange: "Pourquoi ça change ?",
    controls: "Commandes", incidentType: "Type d'incident", randomType: "Type aléatoire",
    trigger: "Déclencher un incident", spoken: "Annonces sonores",
    notifications: "Notifications", assistant: "Assistant",
    askPlaceholder: "Posez une question sur votre trajet", send: "Envoyer",
    likelyOk: "probablement assurée", atRisk: "menacée", unlikely: "peu probable",
    about: "vers", likely: "probablement",
    stoppedSentence: "{label}. À l'arrêt depuis {min} min. Encore {low} à {high} minutes estimées.",
    chatFail: "Désolé, je n'ai pas pu répondre ({error}).",
    chatOffline: "Voici ce que nous savons pour l'instant : {summary}",
    speedTitle: "{s} minute(s) simulée(s) par seconde",
    serverDown: "Impossible de joindre le serveur de simulation : {error}",
    between: "{type} entre {a} et {b}",
    reportTitle: "Rapport", close: "Fermer",
  },
};

function t(key, vars) {
  let s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, v); });
  return s;
}

function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll(".lang").forEach((b) => b.classList.toggle("active", b.dataset.lang === LANG));
}

function setLang(lang) {
  LANG = lang;
  localStorage.setItem("manuella-lang", lang);
  applyI18n();
  if (typeof onLanguageChange === "function") onLanguageChange();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest(".lang");
  if (b && b.dataset.lang !== LANG) setLang(b.dataset.lang);
});
applyI18n();
