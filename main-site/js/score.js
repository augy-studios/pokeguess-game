// Scoring. Each right answer earns points that grow with how quickly it
// came, how many came right before it, how far into the game it is, and the
// difficulty; a finished game adds a bonus that grows with its accuracy and
// its length. The API recomputes this from the log and never takes a score
// from a browser.
//
// Integers throughout, so the page and the server always agree.
//
//   per Pokemon  100, plus up to 100 for speed: all of it within the
//                difficulty's quick time (2 s Normal, 4 s Hard, 5 s Expert),
//                shrinking evenly to none at its slow time (15, 25, 30 s)
//   streak       +10% for each right answer in a row before it, up to +50%
//   progress     +0% on the first Pokemon, rising evenly to +100% on the last
//   difficulty   x1 Normal, x2.5 Hard, x4 Expert
//   help         Hard and Expert: -15% of the Pokemon for each wrong guess
//                before it, -12% for each hint, never below 10%
//   the game     10 x right answers x accuracy, times the difficulty, times
//                the game's length: x1 for 5 Pokemon, x1.25 for 10, x1.5 for
//                20, a quarter more for every doubling, a little less below 5

import { isCorrect } from "./quiz.js";
import { NONE, isAnswer } from "./log.js";

const BASE = 100;
const SPEED_MAX = 100;
const STREAK_STEP = 10;
const STREAK_CAP = 5;
const GAME_BONUS = 10;
export const MISS_COST = 15;
export const HINT_COST = 12;
export const HELP_FLOOR = 10;

// The share of a Pokemon's points, in percent, left after this much help.
export function helpPercent({ misses = 0, hints = 0 } = {}) {
  return Math.max(HELP_FLOOR, 100 - misses * MISS_COST - hints * HINT_COST);
}

// `speed` is the difficulty's [quick, slow] in ms.
export function speedBonus(ms, [full, none]) {
  if (ms <= full) return SPEED_MAX;
  if (ms >= none) return 0;
  return Math.floor((SPEED_MAX * (none - ms)) / (none - full));
}

// What one right answer is worth. `streak` is the right answers in a row
// before it, `index` its place in the game of `count`.
export function pokemonPoints({ ms, streak, index, count, difficulty }) {
  const speed = BASE + speedBonus(ms, difficulty.speed);
  const run = 100 + Math.min(streak, STREAK_CAP) * STREAK_STEP;
  const progress = 100 + (count > 1 ? Math.floor((100 * index) / (count - 1)) : 0);
  return Math.floor((speed * run * progress * difficulty.percent) / 1000000);
}

// A game's length as a percentage multiplier: 100 for 5, 125 for 10, 150
// for 20, and 80 rising by 5 a Pokemon below 5. As in MRT Station Guesser.
export function lengthPercent(count) {
  const n = Math.max(1, Math.floor(count) || 1);
  return n >= 5 ? Math.round(100 + 25 * Math.log2(n / 5)) : 80 + 5 * (n - 1);
}

// The bonus for a finished game: `mine` is how many Pokemon were this
// player's to answer, which is all of them unless others shared the game.
export function gameBonus(correct, mine, count, percent) {
  if (!mine) return 0;
  return Math.floor((GAME_BONUS * correct * correct * percent * lengthPercent(count)) / (mine * 10000));
}

// A log so far, scored. turns[i] is { correct, points } for each entry;
// NONE entries are not this player's and leave the streak alone. `done`
// adds the game bonus.
export function scoreLog(game, entries, { done = entries.length === game.questions.length } = {}) {
  const difficulty = game.difficulty;
  const count = game.questions.length;
  let streak = 0;
  let total = 0;
  let correct = 0;
  let mine = 0;
  const turns = entries.map((e, index) => {
    if (e.pick === NONE) return { correct: false, points: 0, mine: false, streak };
    mine++;
    const right = isAnswer(e.pick) && isCorrect(game.questions[index], e.pick);
    let points = 0;
    if (right) {
      points = Math.floor((pokemonPoints({ ms: e.ms, streak, index, count, difficulty }) * helpPercent(e)) / 100);
      streak++;
      correct++;
      total += points;
    } else {
      streak = 0;
    }
    return { correct: right, points, mine: true, streak };
  });
  const bonus = done ? gameBonus(correct, mine, count, difficulty.percent) : 0;
  return { score: total + bonus, points: total, bonus, correct, mine, streak, turns };
}
