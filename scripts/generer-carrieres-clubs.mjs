// generer-carrieres-clubs.mjs   (VERSION 3 — par championnat + débuts ≥ 1990)
// ─────────────────────────────────────────────────────────────────────────────
// Part de TES clubs, PAR PAYS. Récupère sur WIKIDATA les joueurs NOTABLES dont la
// CARRIÈRE A DÉBUTÉ à partir de 1990 (inclus 1990, 2000, 2010, 2020… sans limite haute).
// Sort UN FICHIER PAR PAYS + un fichier fusionné "carrieres.json" prêt pour le jeu.
// Libre de droits, aucun scraping.
//
// Prérequis : Node 18+.  Exemples :
//   node generer-carrieres-clubs.mjs                       (tous les pays)
//   node generer-carrieres-clubs.mjs --pays france         (un seul pays, pour tester)
//   node generer-carrieres-clubs.mjs --pays france --limit 30   (test court)
//   node generer-carrieres-clubs.mjs --fame 15             (garder plus de joueurs)
//
// Sorties : carrieres-<pays>.json (par championnat) + carrieres.json (fusionné, niveaux)
// Reprenable et poli. La v3 repart de zéro automatiquement (nouveaux filtres).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs/promises";

const VERSION = 3;
const UA = "TomsoFoot-carrieres/3.0 (jeu de devinette; contact: tomsofoot.fr)";
const WD_API = "https://www.wikidata.org/w/api.php";
const SPARQL = "https://query.wikidata.org/sparql";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const SINCE = +arg("--since", 1990);       // année MINIMALE de début de carrière
const MIN_FAME = +arg("--fame", 25);       // notoriété minimale (nb de versions Wikipédia)
const LIMIT = +arg("--limit", Infinity);   // limite de joueurs par pays (test)
const CLUBS_LIMIT = +arg("--clubs", Infinity);
const ONLY = (arg("--pays", "") || "").toLowerCase();
const NOW = new Date().getFullYear();

// ── TES CLUBS, PAR PAYS ──
const CLUBS_BY_COUNTRY = {
  angleterre: ["Liverpool FC","Manchester United FC","Chelsea FC","Arsenal FC","Manchester City FC","Newcastle United FC","Aston Villa FC","Tottenham Hotspur FC","Everton FC"],
  france:     ["Paris Saint-Germain","Olympique de Marseille","Olympique Lyonnais","RC Lens","AS Monaco","AJ Auxerre","FC Girondins de Bordeaux","Lille OSC","FC Sochaux-Montbéliard","AS Saint-Étienne","FC Nantes","FC Metz"],
  espagne:    ["Valencia CF","Villarreal CF","Atlético Madrid","Sevilla FC","Real Madrid CF","FC Barcelona"],
  italie:     ["AS Roma","SS Lazio","Inter Milan","Juventus FC","AC Milan","ACF Fiorentina","SSC Napoli"],
  allemagne:  ["FC Bayern Munich","Borussia Dortmund","VfB Stuttgart"],
};

async function wd(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
const sparql = q => wd(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`);

async function qidClub(nom) {
  const j = await wd(`${WD_API}?action=wbsearchentities&search=${encodeURIComponent(nom)}&language=fr&uselang=fr&type=item&format=json&limit=6&origin=*`);
  const c = (j.search || []).find(x => /foot|soccer|calcio|club/i.test(x.description || "")) || (j.search || [])[0];
  return c ? c.id : null;
}

// PHASE 1 : joueurs NOTABLES ayant joué au club (période datée) depuis SINCE
async function joueursDuClub(clubQid) {
  const q = `
    SELECT DISTINCT ?player ?playerLabel ?sl WHERE {
      ?player p:P54 ?st .
      ?st ps:P54 wd:${clubQid} .
      ?player wdt:P106 wd:Q937857 .
      ?st pq:P580 ?start .
      FILTER(YEAR(?start) >= ${SINCE})
      ?player wikibase:sitelinks ?sl .
      FILTER(?sl >= ${MIN_FAME})
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    }`;
  const j = await sparql(q);
  return j.results.bindings.map(b => ({
    qid: b.player.value.split("/").pop(),
    name: b.playerLabel?.value || "",
    fame: +(b.sl?.value || 0)
  }));
}

// PHASE 2 : carrière propre + date de DÉBUT de carrière (pour le filtre ≥ SINCE)
async function ficheJoueur(qid) {
  const q = `
    SELECT ?team ?teamLabel ?start ?end ?natLabel ?posLabel ?death WHERE {
      wd:${qid} p:P54 ?st .
      ?st ps:P54 ?team .
      ?team wdt:P31/wdt:P279* wd:Q476028 .
      ?st pq:P580 ?start .
      OPTIONAL { ?st pq:P582 ?end . }
      OPTIONAL { wd:${qid} wdt:P27 ?nat . }
      OPTIONAL { wd:${qid} wdt:P413 ?pos . }
      OPTIONAL { wd:${qid} wdt:P570 ?death . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    } ORDER BY ?start`;
  const j = await sparql(q);
  const rows = j.results.bindings;
  if (!rows.length) return null;
  const yr = v => v ? +String(v).slice(0, 4) : null;
  const career = [];
  let firstStart = null, lastEnd = null, ongoing = false;
  for (const b of rows) {
    const club = b.teamLabel?.value || "";
    const a = yr(b.start?.value), z = yr(b.end?.value);
    if (a && (firstStart === null || a < firstStart)) firstStart = a;
    if (z && (lastEnd === null || z > lastEnd)) lastEnd = z;
    if (!b.end) ongoing = true;
    const annees = a ? (z ? a + "–" + String(z).slice(2) : a + "–") : "";
    if (!career.length || career[career.length - 1][0] !== club) career.push([club, annees]);
  }
  const death = rows.some(b => b.death);
  const retired = death || (!ongoing && lastEnd !== null && lastEnd < NOW);
  const dec = y => Math.floor(y / 10) * 10;
  let era = "";
  if (firstStart) {
    const endY = (ongoing && !death) ? NOW : (lastEnd || firstStart);
    era = "Années " + dec(firstStart) + (dec(endY) !== dec(firstStart) ? "–" + dec(endY) : "");
  }
  return { nat: rows[0].natLabel?.value || "", pos: rows[0].posLabel?.value || "", retired, era, firstStart, career };
}

function assignerNiveaux(list) {
  const tri = [...list].sort((a, b) => (b.fame || 0) - (a.fame || 0));
  const N = tri.length || 1;
  tri.forEach((p, i) => { const pct = i / N; p.level = pct < 0.20 ? "amateur" : pct < 0.50 ? "pro" : "expert"; });
}

// ── traiter un pays : phase 1 + phase 2 -> carrieres-<pays>.json ──
async function traiterPays(pays, clubs) {
  const uf = `univers-${pays}.json`, cf = `carrieres-${pays}.json`;
  let univers = null, neuf = true;
  try { const u = JSON.parse(await fs.readFile(uf, "utf8")); if (u.version === VERSION) { univers = u.players; neuf = false; } } catch {}
  if (neuf) {
    console.log(`\n=== ${pays.toUpperCase()} — PHASE 1 (${clubs.length} clubs · notoriété ≥ ${MIN_FAME}) ===`);
    const vus = new Map();
    for (const nom of clubs.slice(0, CLUBS_LIMIT)) {
      try {
        const qid = await qidClub(nom); await sleep(200);
        if (!qid) { console.log("  ? club introuvable :", nom); continue; }
        const js = await joueursDuClub(qid);
        js.forEach(p => { if (p.qid && !vus.has(p.qid)) vus.set(p.qid, p); });
        console.log(`  ✓ ${nom} (${qid}) : ${js.length} joueurs — total ${pays} : ${vus.size}`);
      } catch (e) { console.log("  ✗", nom, "—", e.message); }
      await sleep(300);
    }
    univers = [...vus.values()];
    await fs.writeFile(uf, JSON.stringify({ version: VERSION, players: univers }, null, 2));
  }
  console.log(`${pays} : ${univers.length} joueurs notables.`);

  let car = [];
  if (!neuf) { try { car = JSON.parse(await fs.readFile(cf, "utf8")); } catch {} }
  const faits = new Set(car.map(c => c.id));
  console.log(`${pays} — PHASE 2 (déjà faits : ${faits.size})…`);
  let n = 0;
  for (const j of univers) {
    if (n >= LIMIT) break;
    if (faits.has(j.qid)) continue;
    n++;
    try {
      const f = await ficheJoueur(j.qid);
      if (!f || f.career.length < 2) { console.log("  – trop court :", j.name); await sleep(200); continue; }
      if (f.firstStart && f.firstStart < SINCE) { console.log(`  – débuts avant ${SINCE} :`, j.name); await sleep(200); continue; }
      car.push({ id: j.qid, name: j.name, answer: norm(j.name.split(" ").slice(-1)[0]), level: null,
        retired: f.retired, nat: f.nat, pos: f.pos, era: f.era, fame: j.fame, pays, career: f.career });
      console.log(`  ✓ ${j.name} — ${f.career.length} clubs, notoriété ${j.fame}${f.retired ? " (retraité)" : ""}`);
    } catch (e) { console.log("  ✗", j.name, "—", e.message); }
    if (car.length % 20 === 0) await fs.writeFile(cf, JSON.stringify(car, null, 2));
    await sleep(250);
  }
  await fs.writeFile(cf, JSON.stringify(car, null, 2));
  console.log(`${pays} : ${car.length} joueurs -> ${cf}`);
  return car;
}

async function main() {
  let entries = Object.entries(CLUBS_BY_COUNTRY);
  if (ONLY) entries = entries.filter(([p]) => p === ONLY);
  const tous = [];
  for (const [pays, clubs] of entries) tous.push(...await traiterPays(pays, clubs));

  // fusion (dédoublonnage inter-pays) + niveaux GLOBAUX
  const uniq = new Map();
  for (const p of tous) if (!uniq.has(p.id)) uniq.set(p.id, p);
  const merged = [...uniq.values()];
  assignerNiveaux(merged);
  await fs.writeFile("carrieres.json", JSON.stringify(merged, null, 2));
  const parNiveau = merged.reduce((a, p) => (a[p.level] = (a[p.level] || 0) + 1, a), {});
  console.log(`\n======================================================`);
  console.log(`TOTAL fusionné : ${merged.length} joueurs -> carrieres.json`);
  console.log("Répartition :", parNiveau, "| retraités :", merged.filter(p => p.retired).length);
  console.log("Fichiers par pays : carrieres-angleterre.json, carrieres-france.json, etc.");
  console.log("Astuce : plus de joueurs ->  --fame 15   |   un seul pays ->  --pays italie");
}

main();
