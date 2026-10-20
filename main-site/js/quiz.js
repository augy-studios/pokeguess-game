// A seed into a game: the Pokemon in order, and the names offered beside
// each. Also what counts as a right typed answer, and the hints. Pure, like
// seed.js: the API builds the same game from the same seed to check a
// finished one.

import { POKEMON } from "./pokemon.js";
import { difficultyById, typePool, typeLabel } from "./rules.js";
import { hashString, randomSource } from "./seed.js";

// A whole number below n. The bias from the modulo is under one in a
// million for any list this game has.
const below = (rand, n) => rand() % n;

function shuffled(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = below(rand, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Wrong names for `answer`: up to half of them sharing a type with it, the
// rest from anywhere. Never another form of the same species, whose
// silhouette could be the same, and never two with the same name.
function distractors(answer, need, rand) {
  const a = POKEMON[answer];
  const others = POKEMON.map((_, i) => i).filter((i) => POKEMON[i].species !== a.species);
  const near = others.filter((i) => POKEMON[i].types.some((t) => a.types.includes(t)));
  const order = [...shuffled(near, rand).slice(0, Math.ceil(need / 2)), ...shuffled(others, rand)];
  const out = [];
  const species = new Set([a.species]);
  for (const i of order) {
    if (out.length === need) break;
    if (species.has(POKEMON[i].species)) continue;
    species.add(POKEMON[i].species);
    out.push(i);
  }
  return out;
}

// { seed, difficulty, questions: [{ answer, options, colors, retries }] }.
// answer is an index into POKEMON; options are indices too, with the answer
// among them, or null when the answer is typed. colors is true when the
// question shows the artwork's colours rather than its silhouette, retries
// when a wrong guess leaves it open. Nothing comes up twice in a game.
export function buildGame(seed) {
  const difficulty = difficultyById(seed.difficulty);
  const rand = randomSource(hashString(`pokemon|${seed.text}`));
  const answers = shuffled(typePool(seed.types), rand).slice(0, seed.count);

  const questions = answers.map((answer) => {
    if (!difficulty.choices) {
      return { answer, options: null, colors: difficulty.colors === true, retries: difficulty.retries === true };
    }
    const options = distractors(answer, difficulty.choices - 1, rand);
    options.splice(below(rand, difficulty.choices), 0, answer);
    return { answer, options, colors: false, retries: false };
  });
  return { seed, difficulty, questions };
}

/* ---- typed answers ----
   Forgiving about everything but the Pokemon: case, accents, spaces,
   punctuation, and the order of a form's words, so "Alolan Vulpix",
   "vulpix alola" and "Vulpix-Alola" are one answer. A small slip is
   forgiven too, if it is still nearer that Pokemon than any other. */

// Nidoran's symbols become letters, so the two stay apart.
export function normaliseName(text) {
  return String(text ?? "")
    .replace(/♀/g, " f")
    .replace(/♂/g, " m")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Every name, normalised, to its Pokemon. A name two share counts for
// neither.
const NAMES = new Map();
const AMBIGUOUS = -1;
POKEMON.forEach((p, i) => {
  for (const name of [p.name, ...p.aliases]) {
    const key = normaliseName(name);
    if (key.length < 2) continue;
    const had = NAMES.get(key);
    NAMES.set(key, had === undefined || had === i ? i : AMBIGUOUS);
  }
});

// Edits from a to b, where two letters swapped count as one ("Pikahcu"),
// giving up past `cap`.
function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], before[j - 2] + 1);
      }
      if (row[j] < best) best = row[j];
    }
    if (best > cap) return cap + 1;
    before = prev;
    prev = row;
  }
  return prev[b.length];
}

// How many slips a typed answer of this length may have.
const slack = (length) => (length >= 9 ? 2 : length >= 5 ? 1 : 0);

// The Pokemon a typed answer names, as an index, or -1.
export function matchAnswer(text) {
  const key = normaliseName(text);
  if (key.length < 2) return -1;
  const exact = NAMES.get(key);
  if (exact !== undefined) return exact;

  const cap = slack(key.length);
  if (!cap) return -1;
  let best = cap + 1;
  let found = -1;
  for (const [name, index] of NAMES) {
    const d = editDistance(key, name, cap);
    if (d < best) {
      best = d;
      found = index;
    } else if (d === best && index !== found) {
      found = AMBIGUOUS;
    }
  }
  return best <= cap && found >= 0 ? found : -1;
}

// Whether a pick answers a question: an option's place for multiple choice,
// or the text typed.
export function isCorrect(question, pick) {
  if (question.options) return Number.isInteger(pick) && question.options[pick] === question.answer;
  return typeof pick === "string" && matchAnswer(pick) === question.answer;
}

/* ---- Hard and Expert's retries and hints ---- */

// How a typed guess went: "right"; "form", the right species in another
// form; "wrong", naming another Pokemon; "again", one already tried; or
// "unknown", naming none. Only "wrong" costs anything. `tried` is the set of
// Pokemon guessed so far, and `named` the one this guess names.
export function judgeGuess(question, text, tried) {
  const named = matchAnswer(text);
  if (named === question.answer) return { verdict: "right", named };
  if (named < 0) return { verdict: "unknown", named };
  if (POKEMON[named].species === POKEMON[question.answer].species) return { verdict: "form", named };
  return { verdict: tried.has(named) ? "again" : "wrong", named };
}

const REGION_OF_GEN = ["", "Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];

const FORM_LINES = {
  mega: "It is a Mega Evolution.",
  gmax: "It is a Gigantamax form.",
  primal: "It is a Primal Reversion.",
  regional: "It is a regional form of a Pokémon from elsewhere.",
  alternate: "It is an alternate form of its species.",
};

const listOf = (items) => (items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

function evolutionLine(p) {
  let line =
    p.stages === 1
      ? "It does not evolve."
      : `It is stage ${p.stage} of ${p.stages} in an evolution family of ${p.family}.`;
  if (p.form) line += ` ${FORM_LINES[p.form]}`;
  if (p.rank) line += ` It is ${p.rank === "mythical" ? "a mythical" : "a legendary"} Pokémon.`;
  return line;
}

// A name with only the letters `keep(i)` says to show, i being a letter's
// place in its word. Spaces between words stay wide, and anything not a
// letter shows.
function masked(name, keep) {
  return name
    .split(" ")
    .map((word) => {
      let i = 0;
      return Array.from(word)
        .map((ch) => {
          if (!/\p{L}/u.test(ch)) {
            i = 0;
            return ch;
          }
          return keep(i++) ? ch : "_";
        })
        .join(" ");
    })
    .join("   ");
}

// The first `n` hints for a question, up to HINT_MAX: where and when it is
// from, its types, its category, its family, its Pokedex colour and size,
// the shape of its name, then every other letter.
export function hintsFor(question, n) {
  const p = POKEMON[question.answer];
  const types = p.types.map(typeLabel);
  const all = [
    `It is from generation ${p.gen}, ${REGION_OF_GEN[p.gen] ?? "a later region"}.`,
    `${types.length === 1 ? "Its type is" : "Its types are"} ${listOf(types)}.`,
    p.genus ? `It is the ${p.genus}.` : "Its category is not recorded.",
    evolutionLine(p),
    `${p.color ? `Its Pokédex colour is ${p.color}. ` : ""}It is ${(p.height / 10).toFixed(1)} m tall and weighs ${(p.weight / 10).toFixed(1)} kg.`,
    masked(p.name, (i) => i === 0),
    masked(p.name, (i) => i % 2 === 0),
  ];
  return all.slice(0, n);
}

// Which hints read as a name's shape, so the page can space their letters.
export const NAME_HINTS_FROM = 5;

export const artUrl = (index) => `/art/${POKEMON[index].id}.webp`;
export const pokemonName = (index) => POKEMON[index]?.name ?? "";
