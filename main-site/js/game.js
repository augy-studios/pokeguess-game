// The game screen: choosing a game, playing it alone, and what follows any
// game, alone or with others: the result, the leaderboard, the seed, the
// replay and a link to it. Games with others are run by multiplayer.js,
// which draws through the same pieces.

import {
  TYPES,
  ALL_TYPES,
  DIFFICULTIES,
  COUNT_PRESETS,
  MODE_LABELS,
  FEEDBACK_MS,
  hintLimit,
  maxCount,
  difficultyById,
  describeTypes,
  isTypeMask,
  typeLabel,
  typePool,
} from "./rules.js";
import { newSeed, parseSeed, buildSeed, seedFromText } from "./seed.js";
import { buildGame, judgeGuess } from "./quiz.js";
import { entry, packLog, unpackLog, SKIP } from "./log.js";
import { scoreLog, HINT_COST } from "./score.js";
import { api } from "./api.js";
import * as view from "./view.js";
import { Replay } from "./replay.js";
import { getSettings, saveSettings, onSettingsChange } from "./settings.js";
import { openLeaderboard } from "./leaderboard.js";
import { copyText, hydrateIcons, store } from "./ui.js";

const $ = (id) => document.getElementById(id);
const SETUP_STORAGE = "pokeguessr.setup";
const MODE_LETTERS = { solo: "s", race: "r", turns: "t", duel: "d" };
const QUIT_ARM_MS = 3000;

/* ---- the new-game screen ---- */

const setup = { difficulty: "N", types: ALL_TYPES, count: 10, custom: false, format: "race" };

function loadSetup() {
  const saved = store.getJSON(SETUP_STORAGE) ?? {};
  if (difficultyById(saved.difficulty)) setup.difficulty = saved.difficulty;
  if (isTypeMask(saved.types)) setup.types = saved.types;
  if (Number.isInteger(saved.count) && saved.count >= 1) setup.count = saved.count;
  setup.custom = saved.custom === true || !COUNT_PRESETS.includes(setup.count);
  if (MODE_LABELS[saved.format] && saved.format !== "solo") setup.format = saved.format;
  setup.count = Math.min(setup.count, maxCount(setup.types));
}

function saveSetup() {
  store.set(SETUP_STORAGE, setup);
}

function buildSetup() {
  $("typePick").innerHTML =
    `<button class="type-chip type-all" type="button" aria-pressed="false" data-type="all">All types</button>` +
    `<span class="type-break" aria-hidden="true"></span>` +
    TYPES.map(
      (t) =>
        `<button class="type-chip" type="button" aria-pressed="false" data-type="${t}">` +
        `<span class="type-dot" style="--type-color: var(--type-${t})" aria-hidden="true"></span>${typeLabel(t)}</button>`
    ).join("");
  $("difficultyPick").innerHTML = DIFFICULTIES.map(
    (d) =>
      `<button class="level-btn" type="button" role="radio" aria-checked="false" data-difficulty="${d.id}">` +
      `<b>${d.label}</b><small>x${d.percent / 100}</small></button>`
  ).join("");
  $("countPick").innerHTML =
    COUNT_PRESETS.map((n) => `<button class="mode-btn" type="button" role="radio" aria-checked="false" data-count="${n}">${n}</button>`).join("") +
    `<button class="mode-btn" type="button" role="radio" aria-checked="false" data-count="custom">Custom</button>`;
}

function syncSetup() {
  const max = maxCount(setup.types);
  if (setup.count > max) setup.count = max;
  const check = (container, attr, value) =>
    $(container)
      .querySelectorAll(`[${attr}]`)
      .forEach((b) => b.setAttribute("aria-checked", String(b.getAttribute(attr) === String(value))));
  $("typePick")
    .querySelectorAll("[data-type]")
    .forEach((b) => {
      const t = b.dataset.type;
      const on = t === "all" ? setup.types === ALL_TYPES : setup.types !== ALL_TYPES && (setup.types & (1 << TYPES.indexOf(t))) !== 0;
      b.setAttribute("aria-pressed", String(on));
    });
  const pool = typePool(setup.types).length;
  $("typeNote").textContent =
    setup.types === ALL_TYPES
      ? `Every type, ${pool.toLocaleString("en")} Pokémon to draw from. Pick types to narrow it down.`
      : `${describeTypes(setup.types)}: any Pokémon with one of these types, ${pool.toLocaleString("en")} to draw from.`;
  check("difficultyPick", "data-difficulty", setup.difficulty);
  check("countPick", "data-count", setup.custom ? "custom" : setup.count);
  check("formatPick", "data-format", setup.format);
  $("countPick")
    .querySelectorAll("[data-count]")
    .forEach((b) => {
      b.disabled = b.dataset.count !== "custom" && Number(b.dataset.count) > max;
    });

  const d = difficultyById(setup.difficulty);
  $("difficultyNote").textContent = `${d.about} Points x${d.percent / 100}.`;
  $("customCount").classList.toggle("hidden", !setup.custom);
  const input = $("customCountInput");
  input.max = String(max);
  if (setup.custom && document.activeElement !== input) input.value = String(setup.count);
  $("customCountRange").textContent = `1 to ${max}`;

  $("formatNote").textContent = {
    race: "Up to eight players. Everyone answers every Pokémon; quicker right answers score more.",
    turns: "Up to eight players. The Pokémon go round, one player at a time.",
    duel: "Two players. The first right answer takes the Pokémon; a wrong one is out for that Pokémon.",
  }[setup.format];
  syncSeedNote();
  saveSetup();
}

const currentSettings = () => ({ difficulty: setup.difficulty, types: setup.types, count: setup.count });

export function describeSettings(s) {
  return `${difficultyById(s.difficulty).label}, ${describeTypes(s.types)}, ${s.count} Pokémon`;
}

function syncSeedNote() {
  const parsed = parseSeed($("seedInput").value, currentSettings());
  const note = $("seedNote");
  note.classList.remove("error");
  if (!parsed) {
    note.textContent = "Leave it empty for a new game, or paste a seed to play that game again.";
  } else if (parsed.error) {
    note.classList.add("error");
    note.textContent =
      parsed.error === "count"
        ? "That seed asks for more Pokémon than its types have, or than a game can hold."
        : "That is not a seed. A seed looks like N20-BXK4-M9TR.";
  } else {
    note.textContent = `Plays ${describeSettings(parsed.seed)}. A game on a pasted seed is not scored for the leaderboard.`;
  }
}

// Typing or pasting a full seed sets everything it carries.
function onSeedInput() {
  const parsed = parseSeed($("seedInput").value, currentSettings());
  if (parsed?.seed && !parsed.bare) {
    setup.types = parsed.seed.types;
    setup.difficulty = parsed.seed.difficulty;
    setup.count = parsed.seed.count;
    setup.custom = !COUNT_PRESETS.includes(parsed.seed.count);
  }
  syncSetup();
}

// Changing a setting under a full seed keeps its body, so the field always
// says the game Play will start.
function reseed() {
  const parsed = parseSeed($("seedInput").value, currentSettings());
  if (parsed?.seed && !parsed.bare) {
    const next = buildSeed(setup.difficulty, setup.types, setup.count, parsed.seed.body);
    if (next) $("seedInput").value = next.text;
  }
}

function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
  el.focus();
}

// The settings on screen, checked, for this module and for hosting.
export function getSetup() {
  const parsed = parseSeed($("seedInput").value, currentSettings());
  if (parsed?.error) {
    shake($("seedInput"));
    return null;
  }
  if (setup.custom) {
    const n = Number($("customCountInput").value);
    if (!Number.isInteger(n) || n < 1 || n > maxCount(setup.types)) {
      shake($("customCountInput"));
      return null;
    }
    setup.count = n;
    syncSetup();
  }
  return { ...currentSettings(), format: setup.format, seed: parsed?.seed ?? null };
}

/* ---- panels ---- */

const PANELS = ["setup", "net", "play"];

export function showPanel(name) {
  for (const id of PANELS) $(id).classList.toggle("hidden", id !== name);
}

export function backToSetup() {
  stopSolo();
  replayer.stop();
  shown = null;
  view.setPickHandler(null);
  showPanel("setup");
  syncSetup();
}

/* ---- the chips above the Pokemon ---- */

export function hud({ turn, count, scoreText, streak, progress, seedText }) {
  $("turnChip").textContent = `Pokémon ${Math.min(turn + 1, count)} of ${count}`;
  $("scoreChip").textContent = scoreText ?? "";
  $("streakChip").textContent = streak > 1 ? `Streak ${streak}` : "";
  $("progressFill").style.width = `${Math.round(progress * 100)}%`;
  if (seedText !== undefined) $("seedChip").textContent = seedText;
}

function scoreHud(game, entries, turn) {
  const s = scoreLog(game, entries, { done: false });
  hud({
    turn,
    count: game.questions.length,
    scoreText: `${s.score.toLocaleString("en")} points`,
    streak: s.streak,
    progress: entries.length / game.questions.length,
  });
}

export { scoreHud };

// The playing layout: answers live, nothing of a finished game showing.
export function enterPlay({ seedText, live = true, others = false }) {
  showPanel("play");
  replayer.stop();
  for (const id of ["replayBar", "result"]) $(id).classList.add("hidden");
  $("liveActions").classList.toggle("hidden", !live);
  $("skipBtn").classList.remove("hidden");
  $("skipBtn").disabled = false;
  // Shown by each question that has hints to give.
  $("hintBtn").classList.add("hidden");
  $("mpStrip").classList.toggle("hidden", !others);
  $("turnTimer").classList.add("hidden");
  $("netBar").classList.add("hidden");
  $("seedChip").textContent = seedText;
  disarmQuit();
  syncKeysNote(live);
}

function syncKeysNote(live = !$("liveActions").classList.contains("hidden")) {
  const typed = !$("typedForm").classList.contains("hidden");
  $("keysNote").textContent =
    live && getSettings().show_keys
      ? typed
        ? "Enter answers; Enter on an empty box skips."
        : "Keys: 1 to 4 answer, N or Enter skips or moves on."
      : "";
}

/* ---- Hard and Expert's retries and hints ----
   For playing alone and with others alike. `tries` is one Pokemon's
   { tried, misses, hints }: the Pokemon guessed, and the help so far. */

export const newTries = () => ({ tried: new Set(), misses: 0, hints: 0, armed: null });

// Whether `value` ends the Pokemon. A typed guess that misses a question
// with retries leaves it open, and says so; everything else is final.
export function guessIsFinal(tries, question, value) {
  if (!question.retries || typeof value !== "string") return true;
  const judged = judgeGuess(question, value, tries.tried);
  if (judged.verdict === "right") return true;
  if (judged.verdict === "wrong") {
    tries.tried.add(judged.named);
    tries.misses++;
  }
  view.guessMissed(value, judged, tries);
  return false;
}

// With "ask before taking a hint" on, the first press only says what the
// hint costs, and a second within a few seconds takes it.
export function takeHint(tries, question) {
  if (!question.retries || tries.hints >= hintLimit(question)) return;
  if (getSettings().confirm_hints && !tries.armed) {
    tries.armed = setTimeout(() => (tries.armed = null), QUIT_ARM_MS);
    view.setFeedback(`Press Hint again to take it. Each hint costs ${HINT_COST}% of this Pokémon's points.`);
    return;
  }
  clearTimeout(tries.armed);
  tries.armed = null;
  tries.hints++;
  view.hintTaken(question, tries);
}

/* ---- playing alone ---- */

let solo = null; // the game being played alone
let starting = false;

function unrankedReason(err) {
  switch (err?.code) {
    case "offline":
      return "This game started offline, so it is not scored for the leaderboard.";
    case "not_configured":
      return "The leaderboard is not set up yet, so this game is not scored.";
    case "slow_down":
      return "Too many games started from this connection just now, so this one is not scored.";
    default:
      return "The leaderboard could not be reached when this game started, so it is not scored.";
  }
}
const PASTED = "A game on a pasted seed is not scored for the leaderboard, since its answers could have been seen before.";

async function startSolo() {
  if (starting) return;
  const chosen = getSetup();
  if (!chosen) return;

  starting = true;
  $("startBtn").disabled = true;
  $("startNote").textContent = chosen.seed ? "" : "Starting.";
  let seed = chosen.seed;
  let ticket = null;
  let unranked = seed ? PASTED : null;
  try {
    if (!seed) {
      if (navigator.onLine === false) {
        unranked = unrankedReason({ code: "offline" });
      } else {
        try {
          const t = await api.start({ mode: "solo", players: 1, ...currentSettings() });
          seed = seedFromText(t.seed);
          if (seed) ticket = { gameId: t.game_id, serverSeed: t.server_seed === true };
        } catch (err) {
          unranked = unrankedReason(err);
        }
      }
      if (!seed) {
        seed = newSeed(setup.difficulty, setup.types, setup.count);
        unranked ??= unrankedReason(null);
      }
    }
  } finally {
    starting = false;
    $("startBtn").disabled = false;
    $("startNote").textContent = "";
  }
  beginSolo({ seed, ticket, unranked });
}

function beginSolo({ seed, ticket, unranked }) {
  stopSolo();
  solo = { seed, game: buildGame(seed), entries: [], ticket, unranked, phase: "question", turn: 0, shownAt: null, timer: null };
  enterPlay({ seedText: seed.text });
  view.setPickHandler(onSoloPick);
  showSoloTurn(0);
}

function stopSolo() {
  if (solo) clearTimeout(solo.timer);
  solo = null;
}

function showSoloTurn(i) {
  const g = solo;
  g.turn = i;
  g.phase = "question";
  g.shownAt = null;
  g.tries = newTries();
  scoreHud(g.game, g.entries, i);
  const q = g.game.questions[i];
  view.showQuestion(q, { showKeys: getSettings().show_keys }).then(() => {
    if (solo === g && g.turn === i && g.phase === "question") g.shownAt = performance.now();
  });
  syncKeysNote(true);
  // The next Pokemon, so its artwork is decoded before it is needed.
  // Precached, so offline this is a cache hit.
  const next = g.game.questions[i + 1];
  if (next) view.preloadArt(next.answer);
}

function onSoloPick(value) {
  const g = solo;
  if (!g || g.phase !== "question" || g.shownAt === null) return;
  const q = g.game.questions[g.turn];
  if (!guessIsFinal(g.tries, q, value)) return;
  const ms = performance.now() - g.shownAt;
  const e = entry(value, ms, g.tries);
  g.entries.push(e);
  g.phase = "feedback";
  view.showResult(q, e.pick, { help: e });
  scoreHud(g.game, g.entries, g.turn);
  g.timer = setTimeout(() => advanceSolo(g), FEEDBACK_MS);
}

function advanceSolo(g) {
  if (solo !== g || g.phase !== "feedback") return;
  clearTimeout(g.timer);
  if (g.turn + 1 < g.game.questions.length) {
    showSoloTurn(g.turn + 1);
    return;
  }
  g.phase = "over";
  solo = null;
  view.setPickHandler(null);
  showResult({
    seed: g.seed,
    game: g.game,
    entries: g.entries,
    mode: "solo",
    ticket: g.ticket,
    unranked: g.unranked,
  });
}

/* ---- quitting ---- */

let quitArmed = null;

function disarmQuit() {
  clearTimeout(quitArmed);
  quitArmed = null;
  $("quitBtn").classList.remove("armed");
  $("quitLabel").textContent = mp?.active() ? "Leave" : "Quit";
}

function onQuit() {
  if (!quitArmed) {
    $("quitBtn").classList.add("armed");
    $("quitLabel").textContent = "Press again to quit";
    quitArmed = setTimeout(disarmQuit, QUIT_ARM_MS);
    return;
  }
  disarmQuit();
  if (mp?.active()) mp.leave();
  else backToSetup();
}

/* ---- a finished game ---- */

let replayer = null;
let shown = null; // the record the result panel shows
let mp = null; // multiplayer.js's side, set by setMultiplayer

export function setMultiplayer(adapter) {
  mp = adapter;
}

function packOf(record) {
  return packLog(record.entries);
}

// Shows how a game went. record: { seed, game, entries, mode, ticket,
// unranked, standings?, shared? }. Games with others pass `role`, "host"
// or "guest".
export function showResult(record, { role = null } = {}) {
  shown = record;
  enterPlay({ seedText: record.seed.text, live: false, others: Boolean(record.standings) });
  $("mpStrip").classList.add("hidden");
  view.setPickHandler(null);

  const s = scoreLog(record.game, record.entries);
  const count = record.game.questions.length;
  // Head to head, a Pokemon the other player took first was still yours to
  // win; taking turns, only your own were.
  const tally =
    record.mode === "duel"
      ? `took ${s.correct} of ${count} Pokémon`
      : s.mine === count
        ? `${s.correct} of ${count} right`
        : `${s.correct} of your ${s.mine} Pokémon right`;
  $("resultTitle").textContent = record.shared ? `A shared game: ${tally}` : tally[0].toUpperCase() + tally.slice(1);
  $("resultReason").textContent =
    describeSettings(record.seed) + (record.mode !== "solo" ? `, ${MODE_LABELS[record.mode]}` : "");
  $("resultScore").textContent = record.shared
    ? "A shared replay shows no score: a link can be edited, and only the leaderboard's scores are checked."
    : `${s.score.toLocaleString("en")} points` + (s.bonus ? `, ${s.bonus.toLocaleString("en")} of them for finishing` : "") + ".";

  const standings = $("standings");
  standings.classList.toggle("hidden", !record.standings);
  standings.innerHTML = (record.standings ?? [])
    .map(
      (p, i) =>
        `<li class="${p.you ? "you" : ""}"><span class="standing-rank">${i + 1}</span><span class="standing-name"></span>` +
        `<span class="standing-score">${p.score.toLocaleString("en")}</span></li>`
    )
    .join("");
  // Names come from other devices: text only, never markup.
  standings.querySelectorAll(".standing-name").forEach((el, i) => {
    const p = record.standings[i];
    el.textContent = p.you ? `${p.name} (you)` : p.name;
  });

  $("resultSeed").textContent = `Seed ${record.seed.text}`;
  $("copySeedLabel").textContent = "Copy seed";
  $("shareLabel").textContent = "Share replay";

  // The leaderboard.
  resetSubmit();
  const ranked = !record.shared && record.ticket && !record.unranked;
  $("submitForm").classList.toggle("hidden", !ranked);
  const why = record.shared ? "" : record.unranked ?? (record.ticket ? "" : "This game is not scored for the leaderboard.");
  $("notScored").textContent = why;
  $("notScored").classList.toggle("hidden", !why);
  $("nameInput").value = getSettings().name ?? "";

  // What comes next.
  const again = $("againBtn");
  again.classList.toggle("hidden", role === "guest");
  $("againLabel").textContent = record.shared ? "Play this seed" : "Play again";
  $("newGameLabel").textContent = record.shared ? "Close replay" : role ? "Leave" : "New game";

  $("result").classList.remove("hidden");
  hydrateIcons($("result"));

  const autoplay = getSettings().auto_replay || record.shared;
  $("replayBar").classList.toggle("hidden", !autoplay);
  $("watchBtn").classList.toggle("hidden", autoplay);
  if (autoplay) replayer.load(record, { autoplay: true });
  else replayer.load(record);
  $("resultTitle").focus({ preventScroll: true });

  if (ranked) reportFinish(record);
}

// Stops the server's clock now, rather than whenever a name is added.
async function reportFinish(record) {
  try {
    record.server = await api.finish(record.ticket.gameId, packOf(record));
    if (shown !== record) return;
    const local = scoreLog(record.game, record.entries).score;
    if (record.server.score !== local) console.warn("server scored", record.server.score, "page scored", local);
    const s = getSettings();
    if (s.auto_submit && s.name) submit(s.name);
  } catch (err) {
    if (shown !== record) return;
    // Offline at the end: the Add button finishes it later, once online.
    if (err.code === "offline") return;
    $("submitForm").classList.add("hidden");
    $("notScored").textContent = err.message || "This game could not be scored.";
    $("notScored").classList.remove("hidden");
  }
}

function resetSubmit() {
  $("submitMsg").textContent = "";
  $("submitBtn").disabled = false;
  $("submitted").classList.add("hidden");
}

async function submit(name) {
  const record = shown;
  if (!record?.ticket || record.submitted) return;
  $("submitBtn").disabled = true;
  $("submitMsg").textContent = "";
  try {
    const r = await api.submit(record.ticket.gameId, packOf(record), name);
    record.submitted = true;
    saveSettings({ name: r.name });
    if (shown !== record) return;
    $("submitForm").classList.add("hidden");
    $("submittedText").textContent =
      `Added as ${r.name}: ${r.score.toLocaleString("en")} points, ${r.correct} right. ` +
      `Best ${r.best_score.toLocaleString("en")}, number ${r.rank}. ` +
      `Total ${r.total.toLocaleString("en")} over ${r.games} game${r.games === 1 ? "" : "s"}, number ${r.total_rank}.`;
    $("submitted").classList.remove("hidden");
  } catch (err) {
    if (shown !== record) return;
    $("submitBtn").disabled = false;
    $("submitMsg").textContent =
      err.code === "offline" ? "Adding a game needs a connection. Try again once you are online." : err.message || "That did not go through.";
    // These will never go through, so the form goes.
    if (["already_submitted", "implausible", "pasted_seed", "expired", "not_yours", "conflict", "mismatch"].includes(err.code)) {
      $("submitBtn").disabled = true;
    }
  }
}

/* ---- replay links ----
   Two kinds, the way uwuChess and MRT Station Guesser have them:

   /?watch=<log>&seed=<seed>&mode=<s|r|t|d>  The whole game in the link: the
       seed rebuilds the Pokemon, and the log is every answer and how long
       it took. Nothing is stored anywhere, and it opens offline once the
       site has been visited. Long, since every typed guess rides along.

   /r/<id>  The same three things kept by the API under eight characters.
       Made when sharing while online; offline, the long link is shared. */

const SHORT_ID = /^[A-Za-z0-9]{8}$/;

function replayLink(record) {
  const params = new URLSearchParams({ watch: packOf(record), seed: record.seed.text, mode: MODE_LETTERS[record.mode] ?? "s" });
  return `${location.origin}/?${params}`;
}

// The short link when the API will store one, else the long one. Asked for
// once per game; the same game shared again reuses it.
async function shareLink(record) {
  if (record.shortId) return `${location.origin}/r/${record.shortId}`;
  if (navigator.onLine !== false) {
    try {
      const { id } = await api.createReplay({ seed: record.seed.text, log: packOf(record), mode: MODE_LETTERS[record.mode] ?? "s" });
      if (SHORT_ID.test(id ?? "")) {
        record.shortId = id;
        return `${location.origin}/r/${id}`;
      }
    } catch {
      // Offline, not set up, or refused: the long link works anyway.
    }
  }
  return replayLink(record);
}

async function onShare() {
  if (!shown) return;
  const record = shown;
  const label = $("shareLabel");
  label.textContent = "Making the link";
  const url = await shareLink(record);
  if (shown !== record) return;
  if (navigator.share) {
    try {
      await navigator.share({ title: "PokéGuessr replay", text: `Watch this game of PokéGuessr, seed ${record.seed.text}.`, url });
      label.textContent = "Shared";
      return;
    } catch (err) {
      // Dismissed: nothing to say. Refused or unsupported here: copy instead.
      if (err?.name === "AbortError") {
        label.textContent = "Share replay";
        return;
      }
    }
  }
  label.textContent = (await copyText(url)) ? "Link copied" : "Copy failed";
}

// A replay's parts as a record to watch, or { damaged: true }.
function replayRecord(seedText, packed, modeLetter) {
  const seed = seedFromText(seedText ?? "");
  const game = seed && buildGame(seed);
  const entries = game && unpackLog(packed, game);
  if (!entries) return { damaged: true };
  const mode = Object.keys(MODE_LETTERS).find((m) => MODE_LETTERS[m] === modeLetter) ?? "solo";
  return { seed, game, entries, mode, shared: true };
}

// The address as a replay to watch: a record, { damaged: true } for a broken
// long link, { shortId } for a short one still to fetch, or null for an
// address that is not one.
export function readReplayLink(location) {
  const short = /^\/r\/([A-Za-z0-9]{8})\/?$/.exec(location.pathname);
  if (short) return { shortId: short[1] };
  const params = new URLSearchParams(location.search);
  if (!params.has("watch")) return null;
  return replayRecord(params.get("seed"), params.get("watch"), params.get("mode"));
}

function clearReplayParams() {
  const params = new URLSearchParams(location.search);
  for (const key of ["watch", "seed", "mode"]) params.delete(key);
  const rest = params.toString();
  const path = location.pathname.startsWith("/r/") ? "/" : location.pathname;
  history.replaceState(null, "", path + (rest ? `?${rest}` : "") + location.hash);
}

async function openShortReplay(id) {
  $("startNote").textContent = "Loading the replay.";
  try {
    const r = await api.replay(id);
    const record = replayRecord(r.seed, r.log, r.mode);
    if (record.damaged) throw { code: "damaged" };
    record.shortId = id;
    $("startNote").textContent = "";
    watch(record);
  } catch (err) {
    clearReplayParams();
    $("startNote").textContent =
      err?.code === "offline"
        ? "A short replay link needs a connection to open. Try again once you are online."
        : err?.code === "replay_not_found"
          ? "There is no replay at that link."
          : err?.code === "damaged"
            ? "That replay is from a different version of the Pokémon list, so it cannot be played back."
            : "That replay did not load. Try again in a moment.";
  }
}

function watch(link) {
  stopSolo();
  showResult(link);
}

/* ---- buttons and keys ---- */

function onAgain() {
  const record = shown;
  if (!record) return;
  if (record.shared) {
    // Play the seed that was watched: it fills the new-game screen, and the
    // game it starts is not scored, as with any pasted seed.
    clearReplayParams();
    $("seedInput").value = record.seed.text;
    onSeedInput();
    backToSetup();
    startSolo();
    return;
  }
  if (record.standings) {
    mp?.again();
    return;
  }
  // The same settings, a new seed. A pasted seed played again stays itself.
  if (record.unranked === PASTED) $("seedInput").value = record.seed.text;
  else $("seedInput").value = "";
  syncSeedNote();
  backToSetup();
  startSolo();
}

function onNewGame() {
  if (shown?.shared) clearReplayParams();
  if (shown?.standings && mp?.active()) {
    mp.leave();
    return;
  }
  backToSetup();
}

function onKey(e) {
  if (document.querySelector(".modal-backdrop:not(.hidden)")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ($("play").classList.contains("hidden") || $("liveActions").classList.contains("hidden")) return;
  const inField = e.target.closest("input, textarea");
  if (inField) return;

  if (/^[1-6]$/.test(e.key)) {
    const btn = $("options").querySelector(`[data-pick="${Number(e.key) - 1}"]`);
    if (btn && !btn.disabled) {
      e.preventDefault();
      btn.click();
    }
    return;
  }
  // Enter on a focused button is that button's own; N and Enter elsewhere
  // skip a Pokemon, or move on from an answer without waiting.
  const skip = e.key === "n" || e.key === "N" || (e.key === "Enter" && !e.target.closest("button, a"));
  if (!skip || e.repeat) return;
  e.preventDefault();
  if (solo?.phase === "feedback") advanceSolo(solo);
  else if (solo?.phase === "question") view.pick(SKIP);
  else mp?.skip();
}

export function initGame({ replayLink: link } = {}) {
  replayer = new Replay({ hud });
  view.initView();
  loadSetup();
  buildSetup();
  syncSetup();

  // A type toggles in or out; "All types" resets the filter. Picking the
  // first type out of all of them picks only that one, which is what
  // somebody tapping "Fire" means. Taking the last one out goes back to all.
  $("typePick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-type]");
    if (!btn) return;
    const t = btn.dataset.type;
    if (t === "all") setup.types = ALL_TYPES;
    else {
      const bit = 1 << TYPES.indexOf(t);
      const next = setup.types === ALL_TYPES ? bit : setup.types ^ bit;
      setup.types = next || ALL_TYPES;
    }
    if (setup.count > maxCount(setup.types)) setup.custom = true;
    reseed();
    syncSetup();
  });
  $("difficultyPick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-difficulty]");
    if (!btn) return;
    setup.difficulty = btn.dataset.difficulty;
    reseed();
    syncSetup();
  });
  $("countPick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-count]");
    if (!btn || btn.disabled) return;
    if (btn.dataset.count === "custom") {
      setup.custom = true;
      syncSetup();
      $("customCountInput").focus();
      return;
    }
    setup.custom = false;
    setup.count = Number(btn.dataset.count);
    reseed();
    syncSetup();
  });
  $("customCountInput").addEventListener("input", (e) => {
    const n = Number(e.target.value);
    if (Number.isInteger(n) && n >= 1 && n <= maxCount(setup.types)) {
      setup.count = n;
      reseed();
      syncSeedNote();
      saveSetup();
    }
  });
  $("formatPick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-format]");
    if (!btn) return;
    setup.format = btn.dataset.format;
    syncSetup();
  });
  $("seedInput").addEventListener("input", onSeedInput);
  $("seedInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") startSolo();
  });
  $("seedClear").addEventListener("click", () => {
    $("seedInput").value = "";
    syncSeedNote();
    $("seedInput").focus();
  });
  $("startBtn").addEventListener("click", startSolo);

  $("skipBtn").addEventListener("click", () => {
    if (solo?.phase === "feedback") advanceSolo(solo);
    else if (solo) view.pick(SKIP);
    else mp?.skip();
  });
  $("hintBtn").addEventListener("click", () => {
    if (solo?.phase === "question" && solo.shownAt !== null) takeHint(solo.tries, solo.game.questions[solo.turn]);
    else if (!solo) mp?.hint();
  });
  $("quitBtn").addEventListener("click", onQuit);
  $("seedChip").addEventListener("click", async () => {
    const text = $("seedChip").textContent;
    if (text && (await copyText(text))) {
      $("seedChip").textContent = "Copied";
      setTimeout(() => ($("seedChip").textContent = text), 1200);
    }
  });

  $("copySeedBtn").addEventListener("click", async () => {
    if (shown) $("copySeedLabel").textContent = (await copyText(shown.seed.text)) ? "Copied" : "Copy failed";
  });
  $("shareBtn").addEventListener("click", onShare);
  $("watchBtn").addEventListener("click", () => {
    if (!shown) return;
    $("watchBtn").classList.add("hidden");
    $("replayBar").classList.remove("hidden");
    replayer.load(shown, { autoplay: true });
  });
  $("submitForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("nameInput").value.trim();
    if (!name) {
      $("submitMsg").textContent = "Enter a name.";
      $("nameInput").focus();
      return;
    }
    submit(name);
  });
  $("againBtn").addEventListener("click", onAgain);
  $("newGameBtn").addEventListener("click", onNewGame);
  $("resultBoardBtn").addEventListener("click", () => openLeaderboard());
  document.addEventListener("keydown", onKey);
  onSettingsChange(() => syncKeysNote());

  if (link?.damaged) {
    clearReplayParams();
    $("startNote").textContent = "That replay link is damaged, or from a different version of the Pokémon list.";
  } else if (link?.shortId) {
    openShortReplay(link.shortId);
  } else if (link) {
    watch(link);
  }
}

// For multiplayer.js: whether a solo game is under way, which hosting or
// joining would end.
export const soloActive = () => Boolean(solo);
