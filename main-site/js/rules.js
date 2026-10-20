// The game's settings and limits, in one place for the page and the API.
// Pure: no DOM, nothing browser only, since api/ imports it too.

import { POKEMON } from "./pokemon.js";

// The order is part of every seed's type filter: bit i is TYPES[i].
export const TYPES = [
  "normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground",
  "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
];
export const ALL_TYPES = (1 << TYPES.length) - 1;
export const typeLabel = (id) => id[0].toUpperCase() + id.slice(1);

export const typeMask = (ids) => ids.reduce((m, id) => (TYPES.includes(id) ? m | (1 << TYPES.indexOf(id)) : m), 0);
export const typesOf = (mask) => TYPES.filter((_, i) => mask & (1 << i));
export const isTypeMask = (mask) => Number.isInteger(mask) && mask > 0 && mask <= ALL_TYPES;

// "All types", "Fire", "Fire and Water", "Fire, Water and Grass", "7 types".
export function describeTypes(mask) {
  if (mask === ALL_TYPES) return "All types";
  const names = typesOf(mask).map(typeLabel);
  if (names.length > 3) return `${names.length} types`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// choices: how many names to pick from, 0 for typing the answer. colors: a
// pie chart of the artwork's colours in place of the silhouette. retries: a
// wrong guess leaves the Pokemon open, and hints can be asked for, each
// costing some of its points. percent: what every point is multiplied by.
// speed: answers quicker than the first earn the whole speed bonus, slower
// than the second none of it. turnMs: how long each Pokemon lasts in a game
// with others; alone there is no limit.
export const DIFFICULTIES = [
  {
    id: "N",
    label: "Normal",
    choices: 4,
    percent: 100,
    speed: [2000, 15000],
    turnMs: 15000,
    about: "A silhouette and four names to pick from.",
  },
  {
    id: "H",
    label: "Hard",
    choices: 0,
    retries: true,
    percent: 250,
    speed: [4000, 25000],
    turnMs: 30000,
    about: "A silhouette, and no names: type the Pokémon. Guess as often as you like and ask for hints, but each costs points.",
  },
  {
    id: "X",
    label: "Expert",
    choices: 0,
    colors: true,
    retries: true,
    percent: 400,
    speed: [5000, 30000],
    turnMs: 40000,
    about: "No silhouette, only a pie chart of its colours: type the Pokémon. Guess as often as you like and ask for hints, but each costs points.",
  },
];

export const difficultyById = (id) => DIFFICULTIES.find((d) => d.id === id) ?? null;

// The hints a Pokemon has to give, in Hard and Expert; see quiz.js. Seven in
// words, and in Expert an eighth: its silhouette beside the pie. Hard shows
// the silhouette from the start, so it stops at seven. Takes a difficulty or
// a question, since both carry `colors`.
export const HINT_MAX = 8;
export const hintLimit = ({ colors } = {}) => (colors ? HINT_MAX : HINT_MAX - 1);
// A packed log keeps a Pokemon's wrong guesses in one byte. Past this it is
// long since down to its floor, so more are not counted.
export const MISS_MAX = 255;

export const COUNT_PRESETS = [5, 10, 20, 30];
// The most a game can hold, so a log, a replay link and a stored game stay a
// sensible size.
export const COUNT_MAX = 200;

// Indices into POKEMON a game with these types draws from: any Pokemon with
// at least one of them.
export function typePool(mask) {
  const wanted = new Set(typesOf(mask));
  const out = [];
  POKEMON.forEach((p, i) => {
    if (p.types.some((t) => wanted.has(t))) out.push(i);
  });
  return out;
}

export const maxCount = (mask) => Math.min(COUNT_MAX, typePool(mask).length);

/* ---- timing ----
   Every answer carries how long it took, measured from the moment the
   Pokemon was on screen, to the nearest 10 ms. The score pays for speed, and
   the API holds those times against its own clock. */

export const MS_STEP = 10;
// Two bytes of 10 ms in a packed log.
export const MS_MAX = 65535 * MS_STEP;
// Quicker than this, nobody looked. A typed answer also needs time for each
// character.
export const MIN_ANSWER_MS = 350;
export const MIN_TYPED_MS = 250;
export const MS_PER_TYPED_CHAR = 40;
// The shortest name is two characters ("Mew" is three), so a wrong guess took
// at least this long to type.
export const MIN_MISS_MS = MIN_TYPED_MS + 2 * MS_PER_TYPED_CHAR;
// A typed answer's length cap, in characters.
export const TYPED_MAX = 40;
export const turnLimitMs = (difficultyId) => difficultyById(difficultyId)?.turnMs ?? 15000;
// How long the page shows the answer before the next Pokemon.
export const FEEDBACK_MS = 1200;
// What the API allows between the page's clock and its own.
export const CLOCK_SLACK_MS = 5000;

/* ---- ways to play ---- */

// solo: one person. race: everyone answers every Pokemon. turns: players
// take them in turn. duel: two players, first right answer takes it.
export const MODES = ["solo", "race", "turns", "duel"];
export const MP_MODES = ["race", "turns", "duel"];
export const MAX_PLAYERS = { solo: 1, race: 8, turns: 8, duel: 2 };
export const MODE_LABELS = { solo: "Solo", race: "Race", turns: "Take turns", duel: "Head to head" };
