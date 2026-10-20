// The question on screen: the silhouette (or in Expert, a pie of the
// artwork's colours), the names to pick from or the box to type in, and the
// line saying how an answer went. Playing alone, playing with others and
// watching a replay all draw through here, so a Pokemon looks the same in
// each.

import { POKEMON } from "./pokemon.js";
import { ART_COLORS } from "./colors.js";
import { artUrl, pokemonName, matchAnswer, isCorrect, hintsFor, NAME_HINTS_FROM, NAME_HINTS_TO } from "./quiz.js";
import { NONE, SKIP, TIMEOUT, isAnswer } from "./log.js";
import { hintLimit } from "./rules.js";
import { helpPercent } from "./score.js";
import { escapeHtml } from "./ui.js";

const $ = (id) => document.getElementById(id);

let pickHandler = null;
let shown = 0;
let currentIndex = -1; // the Pokemon whose question is on screen

/* ---- artwork as images that say nothing ----
   The page never points at /art/<id>.webp, which would name the answer to
   anybody inspecting it, and never shows the artwork itself until the answer
   is in: it is drawn into a canvas as a silhouette. Each artwork is fetched
   (from the service worker's cache, so offline too) and decoded from a blob:
   URL. Kept for the page's life: a game is a few megabytes at most, and a
   replay or a second game reuses them. The network panel still shows the
   fetch; this keeps the answer out of the page, not out of devtools. */

const images = new Map(); // POKEMON index -> Promise of a decoded image

function artImage(index) {
  let image = images.get(index);
  if (!image) {
    image = fetch(artUrl(index))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.blob();
      })
      .then(async (blob) => {
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        return img;
      });
    // A failure is not kept, so the next showing tries again.
    image.catch(() => images.delete(index));
    images.set(index, image);
  }
  return image;
}

// Fetches a Pokemon's artwork ahead of its question, so it is ready the
// moment it is due.
export function preloadArt(index) {
  artImage(index).catch(() => {});
}

// Whoever is playing now: a solo game, a game with others, or nobody while
// a replay shows. Called with an option's place, the text typed, or SKIP.
export function setPickHandler(fn) {
  pickHandler = fn;
}

export function pick(value) {
  pickHandler?.(value);
}

/* ---- the canvas ---- */

const ink = () => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#121815";

// The whole stage, and Expert's silhouette hint: the top left, clear of the
// pie, which moves to the bottom right (see .art-stage.silhouette).
const FULL = { x: 0.04, y: 0.04, size: 0.92 };
const BESIDE_PIE = { x: 0.03, y: 0.03, size: 0.6 };

// Draws `img` fitted into `box` (fractions of the canvas) and centred in it,
// filled flat with the page's ink colour when `silhouette` is set. Read each
// time, so a theme changed mid game is followed.
function paint(img, silhouette, box = FULL) {
  const canvas = $("artCanvas");
  const ctx = canvas.getContext("2d");
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  const side = box.size * Math.min(W, H);
  const scale = Math.min(side / img.naturalWidth, side / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, box.x * W + (side - w) / 2, box.y * H + (side - h) / 2, w, h);
  if (silhouette) {
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = ink();
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }
}

function clearArt() {
  const canvas = $("artCanvas");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

/* ---- Expert's pie chart ----
   Chart.js, vendored and precached like everything else, so Expert plays
   offline. It is a classic script, loaded on the first pie rather than with
   the page, since only Expert needs it. Hovering or touching a slice shows
   its percentage. */

const CHART_SRC = "/js/vendor/chart.umd.min.js";
let chartLib = null;
let pie = null;

function loadChart() {
  if (!chartLib) {
    chartLib = new Promise((resolve, reject) => {
      if (window.Chart) return resolve(window.Chart);
      const script = document.createElement("script");
      script.src = CHART_SRC;
      script.onload = () => (window.Chart ? resolve(window.Chart) : reject(new Error("no Chart")));
      script.onerror = () => reject(new Error("Chart.js did not load"));
      document.head.append(script);
    });
    // A failure is not kept, so the next pie tries again.
    chartLib.catch(() => (chartLib = null));
  }
  return chartLib;
}

async function drawColors(index) {
  const Chart = await loadChart();
  const colors = ART_COLORS[POKEMON[index].id] ?? [];
  // The edge lets a white slice read against a pale card.
  const data = {
    labels: colors.map(() => ""),
    datasets: [
      {
        data: colors.map(([, percent]) => percent),
        backgroundColor: colors.map(([hex]) => hex),
        borderColor: ink(),
        borderWidth: 1,
        hoverOffset: 10,
      },
    ],
  };
  const canvas = $("artPie");
  // Named for what it is, never for whose it is.
  canvas.setAttribute(
    "aria-label",
    `A pie chart of the Pokémon's colours, ${colors.length} slices: ${colors.map(([, p]) => `${p}%`).join(", ")}.`
  );
  if (pie) {
    pie.data = data;
    pie.update();
    return;
  }
  pie = new Chart(canvas, {
    type: "pie",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Drawn at once, so the clock starts on a whole pie.
      animation: { duration: 0 },
      transitions: { active: { animation: { duration: 150 } } },
      layout: { padding: 12 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: () => "",
            label: (ctx) => ` ${ctx.parsed}%`,
          },
        },
      },
    },
  });
}

// Draws `question` and resolves once its silhouette, or the pie of its
// colours, is on screen, or failed to load, which is when an answer's clock
// starts. Answering stays off until then unless `interactive` is false
// anyway.
export function showQuestion(question, { interactive = true, prompt, showKeys = true } = {}) {
  const token = ++shown;
  const stage = $("artStage");
  currentIndex = question.answer;

  $("prompt").textContent =
    prompt ??
    (question.options
      ? "Who's that Pokémon?"
      : question.colors
        ? "Whose colours are these? Type the Pokémon, as often as you like."
        : "Who's that Pokémon? Type its name, as often as you like.");
  setFeedback("");
  $("artNote").textContent = "";
  stage.classList.toggle("colors", question.colors === true);
  stage.classList.remove("revealed", "silhouette");
  showHints(question, 0);
  $("hintBtn").classList.toggle("hidden", !question.retries);

  const options = $("options");
  const typed = $("typedForm");
  if (question.options) {
    options.innerHTML = question.options
      .map(
        (c, i) =>
          `<button type="button" class="answer" data-pick="${i}" disabled aria-keyshortcuts="${i + 1}">` +
          `<span class="answer-key" aria-hidden="true">${i + 1}</span>` +
          `<span class="answer-name">${escapeHtml(pokemonName(c))}</span></button>`
      )
      .join("");
    options.classList.toggle("show-keys", showKeys);
    options.classList.remove("hidden");
    typed.classList.add("hidden");
  } else {
    options.innerHTML = "";
    options.classList.add("hidden");
    typed.classList.remove("hidden");
    const input = $("typedInput");
    input.value = "";
    input.readOnly = false;
    input.classList.remove("right", "wrong");
  }
  setInteractive(false);

  return new Promise((resolve) => {
    const done = (ok) => {
      if (token !== shown) return;
      stage.classList.add("loaded");
      if (!ok) {
        $("artNote").textContent = question.colors
          ? "The colours did not load. Skip it, or answer anyway."
          : "This Pokémon did not load. Skip it, or answer anyway.";
      }
      if (interactive) setInteractive(true);
      resolve(ok);
    };
    if (question.colors) {
      clearArt();
      drawColors(question.answer).then(
        () => done(true),
        () => done(false)
      );
      return;
    }
    stage.classList.remove("loaded");
    artImage(question.answer).then(
      (img) => {
        if (token !== shown) return;
        paint(img, true);
        done(true);
      },
      () => {
        if (token !== shown) return;
        clearArt();
        done(false);
      }
    );
  });
}

// Once an answer is in, the artwork in full colour.
function revealArt(index) {
  const token = shown;
  const stage = $("artStage");
  artImage(index).then(
    (img) => {
      if (token !== shown) return;
      paint(img, false);
      stage.classList.remove("colors", "silhouette");
      stage.classList.add("revealed", "loaded");
    },
    () => {}
  );
}

export function setInteractive(on) {
  $("options")
    .querySelectorAll(".answer")
    .forEach((b) => {
      b.disabled = !on;
    });
  $("typedInput").disabled = !on;
  $("typedBtn").disabled = !on;
  $("hintBtn").disabled = !on || hintsShown >= hintsMax;
  if (on && !$("typedForm").classList.contains("hidden")) $("typedInput").focus({ preventScroll: true });
}

/* ---- Hard and Expert's retries and hints ---- */

let hintsShown = 0;
let hintsMax = 0;

// The first `n` of the question's hints, under the answer box, and the hint
// button saying what is left.
export function showHints(question, n) {
  hintsShown = n;
  hintsMax = hintLimit(question);
  const list = $("hints");
  list.innerHTML = hintsFor(question, n)
    .map((text, i) => `<li><span class="${i >= NAME_HINTS_FROM && i < NAME_HINTS_TO ? "hint-name" : ""}">${escapeHtml(text)}</span></li>`)
    .join("");
  list.classList.toggle("hidden", n === 0);
  $("hintLabel").textContent = n >= hintsMax ? "No more hints" : `Hint ${n + 1} of ${hintsMax}`;
  if (n >= hintsMax) $("hintBtn").disabled = true;
}

// Expert's last hint: the silhouette in the top left of the stage, with the
// pie moved down to the bottom right beside it.
function showSilhouette(index) {
  const token = shown;
  const stage = $("artStage");
  artImage(index).then(
    (img) => {
      if (token !== shown || stage.classList.contains("revealed")) return;
      paint(img, true, BESIDE_PIE);
      stage.classList.add("silhouette");
    },
    () => {}
  );
}

const worthLine = (help) => `This Pokémon is now worth ${helpPercent(help)}% of its points.`;

// A hint just given: shown, and what it cost.
export function hintTaken(question, help) {
  showHints(question, help.hints);
  setFeedback(`Hint ${help.hints}. ${worthLine(help)}`);
  if (question.colors && help.hints >= hintLimit(question)) showSilhouette(question.answer);
  $("typedInput").focus({ preventScroll: true });
}

// A guess that did not get it, with the Pokemon left open for another.
// `help` is the wrong guesses and hints so far, counting this one.
export function guessMissed(text, { verdict, named }, help) {
  const input = $("typedInput");
  input.value = "";
  input.classList.remove("shake");
  void input.offsetWidth;
  input.classList.add("shake");
  input.focus({ preventScroll: true });
  if (verdict === "unknown") setFeedback(`"${text}" is not a Pokémon this knows. Try again; that one is free.`, "bad");
  else if (verdict === "form") setFeedback(`Right species, but not ${pokemonName(named)}. Which form? That one is free.`, "bad");
  else if (verdict === "again") setFeedback(`You already tried ${pokemonName(named)}. Try another; that one is free.`, "bad");
  else setFeedback(`Not ${pokemonName(named)}. ${worthLine(help)}`, "bad");
}

// An answer sent and not yet confirmed, in a game with others.
export function markPending(value) {
  if (Number.isInteger(value)) $("options").querySelector(`[data-pick="${value}"]`)?.classList.add("picked");
}

export function setFeedback(text, tone = "") {
  const el = $("feedback");
  el.textContent = text;
  el.dataset.tone = tone;
}

// Marks how `value` answered `question`: the right name ringed, a wrong
// pick crossed, and the artwork shown in colour. Says so in the feedback
// line unless `say` is false, or says `say` when it is a string. `help` is
// the { misses, hints } before the answer. Returns whether it was right.
export function showResult(question, value, { say = true, help = null } = {}) {
  const answer = pokemonName(question.answer);
  const right = isAnswer(value) && isCorrect(question, value);

  if (question.options) {
    $("options")
      .querySelectorAll(".answer")
      .forEach((b) => {
        const i = Number(b.dataset.pick);
        b.disabled = true;
        b.classList.toggle("right", question.options[i] === question.answer);
        b.classList.toggle("wrong", i === value && !right);
        b.classList.toggle("picked", i === value);
      });
  } else {
    const input = $("typedInput");
    input.value = typeof value === "string" ? value : "";
    input.readOnly = true;
    input.disabled = true;
    $("typedBtn").disabled = true;
    input.classList.toggle("right", right);
    input.classList.toggle("wrong", typeof value === "string" && !right);
  }
  revealArt(question.answer);
  $("hintBtn").disabled = true;
  if (question.retries) showHints(question, help?.hints ?? 0);

  if (typeof say === "string") {
    setFeedback(say, right ? "ok" : value === NONE ? "" : "bad");
  } else if (say) {
    setFeedback(describe(question, value, right, answer) + helpLine(help, right), right ? "ok" : "bad");
  }
  return right;
}

// After a typed answer's line: the help it took, and what that left.
function helpLine(help, right) {
  const parts = [];
  if (help?.misses) parts.push(`${help.misses} wrong guess${help.misses === 1 ? "" : "es"}`);
  if (help?.hints) parts.push(`${help.hints} hint${help.hints === 1 ? "" : "s"}`);
  if (!parts.length) return "";
  return ` ${parts.join(" and ")}${right ? `, so ${helpPercent(help)}% of the points` : ""}.`;
}

function describe(question, value, right, answer) {
  if (right) return `Right, it's ${answer}.`;
  if (value === SKIP) return `Skipped. It's ${answer}.`;
  if (value === TIMEOUT) return `Out of time. It's ${answer}.`;
  if (value === NONE) return `It's ${answer}.`;
  if (typeof value === "string") {
    const named = matchAnswer(value);
    if (named >= 0) return `Not ${pokemonName(named)}. It's ${answer}.`;
    return `"${value}" is not a Pokémon this knows. It's ${answer}.`;
  }
  return `Not ${pokemonName(question.options[value])}. It's ${answer}.`;
}

// The silhouette follows the page's ink, so a theme change redraws it.
function repaint() {
  const stage = $("artStage");
  if (stage.classList.contains("revealed")) return;
  const beside = stage.classList.contains("silhouette");
  if (stage.classList.contains("colors") && !beside) return;
  const token = shown;
  const index = currentIndex;
  if (index < 0) return;
  artImage(index).then((img) => token === shown && paint(img, true, beside ? BESIDE_PIE : FULL), () => {});
}

export function initView() {
  $("options").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pick]");
    if (btn && !btn.disabled) pick(Number(btn.dataset.pick));
  });
  $("typedForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("typedInput").disabled) return;
    const text = $("typedInput").value.trim();
    // An empty answer is a skip, so Enter alone passes on a Pokemon.
    pick(text ? text : SKIP);
  });
  new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
}
