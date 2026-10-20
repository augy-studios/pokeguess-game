#!/usr/bin/env node
// Tests the pure modules the page and the API share: the data, seeds,
// building a game, typed answers, packed logs and scoring. Nothing to
// install.
//
// Run: node scripts/test-quiz.mjs

import { POKEMON } from "../main-site/js/pokemon.js";
import { ART_COLORS } from "../main-site/js/colors.js";
import { ALL_TYPES, DIFFICULTIES, TYPES, maxCount, typeMask, typePool, MS_MAX, COUNT_MAX } from "../main-site/js/rules.js";
import { newSeed, parseSeed, seedFromText, buildSeed, encodeTypes, decodeTypes, typesKey } from "../main-site/js/seed.js";
import { buildGame, matchAnswer, isCorrect, judgeGuess, normaliseName, hintsFor } from "../main-site/js/quiz.js";
import { packLog, unpackLog, entry, SKIP, TIMEOUT, NONE } from "../main-site/js/log.js";
import { scoreLog, pokemonPoints, speedBonus, lengthPercent, helpPercent } from "../main-site/js/score.js";

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}${detail ? `: ${detail}` : ""}`);
  }
}
const byName = (name) => POKEMON.findIndex((p) => p.name === name);
const nameOf = (i) => (i >= 0 ? POKEMON[i].name : String(i));
const normal = DIFFICULTIES.find((d) => d.id === "N");

/* ---- data ---- */
check("at least the 1025 species", POKEMON.length >= 1025, String(POKEMON.length));
check("ids unique", new Set(POKEMON.map((p) => p.id)).size === POKEMON.length);
check("every species present", new Set(POKEMON.map((p) => p.species)).size === 1025);
for (const p of POKEMON) {
  check(`${p.name} has types`, p.types.length >= 1 && p.types.every((t) => TYPES.includes(t)), p.types.join());
  check(`${p.name} has a generation`, Number.isInteger(p.gen) && p.gen >= 1 && p.gen <= 9, String(p.gen));
  check(`${p.name} stage within family`, p.stage >= 1 && p.stage <= p.stages, `${p.stage}/${p.stages}`);
  // The name a player would type has to come back as this Pokemon.
  check(`"${p.name}" names itself`, matchAnswer(p.name) === POKEMON.indexOf(p), nameOf(matchAnswer(p.name)));
}
const keys = new Map();
for (const p of POKEMON) {
  const key = normaliseName(p.name);
  check(`name ${p.name} unique`, !keys.has(key), keys.get(key));
  keys.set(key, p.name);
}

/* ---- seeds ---- */
check("type filter round trips", [1, 5, 1 << 17, ALL_TYPES - 1, 12345].every((m) => decodeTypes(encodeTypes(m)) === m));
check("no types is not a filter", decodeTypes(encodeTypes(0)) === null);
check("types key", typesKey(ALL_TYPES) === "all" && typesKey(2) === encodeTypes(2));
const masks = [ALL_TYPES, typeMask(["fire"]), typeMask(["water", "ice"]), typeMask(["dragon", "fairy", "ghost"])];
for (let n = 0; n < 200; n++) {
  const m = masks[n % masks.length];
  const d = DIFFICULTIES[n % DIFFICULTIES.length].id;
  const count = 1 + (n % maxCount(m));
  const s = newSeed(d, m, count);
  check("new seed round trips", seedFromText(s.text)?.text === s.text, s.text);
  check("seed parses with junk", parseSeed(` ${s.text.toLowerCase().replace(/-/g, " ")} `)?.seed?.text === s.text, s.text);
}
check("all types carry no filter", buildSeed("N", ALL_TYPES, 20, "BCDFGHJK").text === "N20-BCDF-GHJK");
const fire = typeMask(["fire"]);
check("a filter is written after T", buildSeed("H", fire, 10, "BCDFGHJK").text === `H10-T${encodeTypes(fire)}-BCDF-GHJK`);
check("count past the types refused", parseSeed(`N${maxCount(fire) + 1}-T${encodeTypes(fire)}-BCDF-GHJK`)?.error === "count");
check(`count past ${COUNT_MAX} refused`, parseSeed(`N${COUNT_MAX + 1}-BCDF-GHJK`)?.error === "count");
check("all types written as a filter refused", parseSeed(`N20-T${encodeTypes(ALL_TYPES)}-BCDF-GHJK`)?.error === "bad");
check("bare body takes settings", parseSeed("bcdf ghjk", { difficulty: "X", types: ALL_TYPES, count: 10 })?.seed?.text === "X10-BCDF-GHJK");
check("bare body ending a count", parseSeed("N2-2BCD-FGHJ")?.seed?.text === "N2-2BCD-FGHJ");
check("vowels refused", parseSeed("N20-AAAA-AAAA")?.error === "bad");
check("unknown difficulty refused", parseSeed("Q20-BCDF-GHJK")?.error === "bad");
check("non canonical text refused", seedFromText("n20-bcdf-ghjk") === null);

/* ---- games ---- */
for (const d of DIFFICULTIES) {
  for (const m of masks) {
    const seed = buildSeed(d.id, m, maxCount(m), "BCDFGHJK");
    const g = buildGame(seed);
    const again = buildGame(seedFromText(seed.text));
    check(`${seed.text} deterministic`, JSON.stringify(g.questions) === JSON.stringify(again.questions));
    const answers = g.questions.map((q) => q.answer);
    check(`${seed.text} no repeats`, new Set(answers).size === answers.length);
    check(`${seed.text} full count`, answers.length === maxCount(m));
    const pool = new Set(typePool(m));
    check(`${seed.text} in the types`, answers.every((a) => pool.has(a)));
    for (const q of g.questions) {
      if (!d.choices) {
        check(`${seed.text} typed has no options`, q.options === null);
        check(`${seed.text} colours only in Expert`, q.colors === (d.id === "X"));
        check(`${seed.text} typed has retries`, q.retries === true);
        continue;
      }
      check(`${seed.text} option count`, q.options.length === d.choices);
      check(`${seed.text} answer once`, q.options.filter((o) => o === q.answer).length === 1);
      const species = q.options.map((o) => POKEMON[o].species);
      check(`${seed.text} one option per species`, new Set(species).size === species.length);
    }
  }
}
const a = buildGame(buildSeed("N", ALL_TYPES, 20, "BCDFGHJK"));
const b = buildGame(buildSeed("N", ALL_TYPES, 20, "BCDFGHJL"));
check("different seeds differ", JSON.stringify(a.questions) !== JSON.stringify(b.questions));

/* ---- typed answers ---- */
const typed = [
  ["pikachu", "Pikachu"], ["PIKACHU", "Pikachu"], ["Pikahcu", "Pikachu"], ["pikachuu", "Pikachu"],
  ["mr mime", "Mr. Mime"], ["Mr. Mime", "Mr. Mime"], ["farfetchd", "Farfetch'd"], ["Farfetch’d", "Farfetch'd"],
  ["Nidoran♀", "Nidoran♀"], ["nidoran f", "Nidoran♀"], ["Nidoran female", "Nidoran♀"], ["nidoran m", "Nidoran♂"],
  ["type null", "Type: Null"], ["porygon z", "Porygon-Z"], ["porygon2", "Porygon2"], ["ho oh", "Ho-Oh"],
  ["flabebe", "Flabébé"], ["alolan vulpix", "Alolan Vulpix"], ["vulpix alola", "Alolan Vulpix"],
  ["Vulpix-Alola", "Alolan Vulpix"], ["mega charizard x", "Mega Charizard X"], ["charizard mega x", "Mega Charizard X"],
  ["gmax pikachu", "Gigantamax Pikachu"], ["Gigantamax Pikachu", "Gigantamax Pikachu"], ["hisuian zorua", "Hisuian Zorua"],
  ["galarian darmanitan", "Galarian Darmanitan"], ["primal kyogre", "Primal Kyogre"], ["heat rotom", "Heat Rotom"],
];
for (const [text, name] of typed) {
  const got = matchAnswer(text);
  check(`typed "${text}"`, got === byName(name), nameOf(got));
}
check("a slip as near two Pokemon counts for neither", matchAnswer("pikchu") === -1, nameOf(matchAnswer("pikchu")));
check("Mew is not Mewtwo", matchAnswer("mew") !== matchAnswer("mewtwo"));
check("Porygon is not Porygon2", matchAnswer("porygon") !== matchAnswer("porygon2"));
check("nonsense refused", matchAnswer("xx") === -1 && matchAnswer("") === -1 && matchAnswer("qwertyuiop") === -1);

const alolanVulpix = { answer: byName("Alolan Vulpix"), options: null, retries: true };
check("the species for a form is free", judgeGuess(alolanVulpix, "vulpix", new Set()).verdict === "form");
check("the form is right", judgeGuess(alolanVulpix, "alolan vulpix", new Set()).verdict === "right");
check("another Pokemon is wrong", judgeGuess(alolanVulpix, "growlithe", new Set()).verdict === "wrong");
check("the same wrong twice is free", judgeGuess(alolanVulpix, "growlithe", new Set([byName("Growlithe")])).verdict === "again");
check("an unknown name is free", judgeGuess(alolanVulpix, "blorp", new Set()).verdict === "unknown");
check("typed answer is correct", isCorrect(alolanVulpix, "Alolan Vulpix") && !isCorrect(alolanVulpix, "Vulpix"));

for (const p of [byName("Pikachu"), byName("Mega Charizard X"), byName("Type: Null")]) {
  const hints = hintsFor({ answer: p }, 7);
  check(`${POKEMON[p].name} has seven hints`, hints.length === 7 && hints.every((h) => typeof h === "string" && h.length > 3));
  // No hint but the letter ones may give the name away.
  check(`${POKEMON[p].name} hints keep the name back`, hints.slice(0, 5).every((h) => !h.toLowerCase().includes(POKEMON[p].name.toLowerCase())));
}

/* ---- logs ---- */
const choice = buildGame(buildSeed("N", ALL_TYPES, 6, "BCDFGHJK"));
const entries = [entry(0, 1234), entry(2, 999999), entry(SKIP, 3000), entry(TIMEOUT, 15000), entry(NONE, 0), entry(3, 351)];
const packed = packLog(entries);
const back = unpackLog(packed, choice);
check("log round trips", JSON.stringify(back) === JSON.stringify(entries.map((e) => ({ ...e }))), JSON.stringify(back));
check("ms capped", back?.[1].ms === MS_MAX);
check("short log refused", unpackLog(packLog(entries.slice(0, 5)), choice) === null);
check("short log fine when partial", unpackLog(packLog(entries.slice(0, 5)), choice, { partial: true })?.length === 5);
check("long log refused", unpackLog(packLog([...entries, entry(0, 500)]), choice) === null);
check("option past the choices refused", unpackLog(packLog(entries.map((e, i) => (i ? e : entry(4, 500)))), choice) === null);
check("typed in a choice game refused", unpackLog(packLog(entries.map((e, i) => (i ? e : entry("Pikachu", 900)))), choice) === null);
check("help in a choice game refused", unpackLog(packLog(entries.map((e, i) => (i ? e : { ...entry(0, 900), misses: 1 }))), choice) === null);
check("junk refused", unpackLog("!!", choice) === null && unpackLog("", choice) === null && unpackLog(null, choice) === null);

const hard = buildGame(buildSeed("H", ALL_TYPES, 3, "BCDFGHJK"));
const typedEntries = [entry("  Flabébé  ", 4000, { misses: 2, hints: 3 }), entry("Nidoran♀", 2000), entry(SKIP, 100, { hints: 1 })];
const typedBack = unpackLog(packLog(typedEntries), hard);
check(
  "typed log round trips",
  typedBack?.[0].pick === "Flabébé" && typedBack?.[0].misses === 2 && typedBack?.[0].hints === 3 && typedBack?.[1].pick === "Nidoran♀" && typedBack?.[2].hints === 1,
  JSON.stringify(typedBack)
);
check("choice pick in a typed game refused", unpackLog(packLog([entry(1, 500), ...typedEntries.slice(1)]), hard) === null);

/* ---- scoring ---- */
check("speed full", speedBonus(0, normal.speed) === 100 && speedBonus(2000, normal.speed) === 100);
check("speed none", speedBonus(15000, normal.speed) === 0 && speedBonus(60000, normal.speed) === 0);
check("speed halfway", speedBonus(8500, normal.speed) === 50);
check("first, slow, no streak, Normal", pokemonPoints({ ms: 20000, streak: 0, index: 0, count: 20, difficulty: normal }) === 100);
check("last doubles", pokemonPoints({ ms: 20000, streak: 0, index: 19, count: 20, difficulty: normal }) === 200);
check("length multiplier", lengthPercent(5) === 100 && lengthPercent(10) === 125 && lengthPercent(20) === 150 && lengthPercent(1) === 80);
check("help floor", helpPercent({ misses: 10, hints: 7 }) === 10 && helpPercent({ misses: 1, hints: 1 }) === 73);

const g20 = buildGame(buildSeed("N", ALL_TYPES, 20, "BCDFGHJK"));
const perfect = g20.questions.map((q) => entry(q.options.indexOf(q.answer), 1500));
const s = scoreLog(g20, perfect);
check("perfect game counts 20", s.correct === 20 && s.mine === 20);
check("perfect game bonus, x1.5 for 20", s.bonus === 300, String(s.bonus));
const allWrong = g20.questions.map((q) => entry(q.options.findIndex((o) => o !== q.answer), 1500));
check("all wrong scores 0", scoreLog(g20, allWrong).score === 0);
const turns = perfect.map((e, i) => (i % 2 ? entry(NONE, 0) : e));
const t = scoreLog(g20, turns);
check("turns: half are mine", t.mine === 10 && t.correct === 10);
check("turns: streak runs across others'", t.turns[18].streak === 10);
const g40 = buildGame(buildSeed("N", ALL_TYPES, 40, "BCDFGHJK"));
const longer = scoreLog(g40, g40.questions.map((q) => entry(q.options.indexOf(q.answer), 1500)));
check("a longer game scores more than twice", longer.score > s.score * 2, `${longer.score} vs ${s.score}`);
for (const [id, times] of [["H", 2.5], ["X", 4]]) {
  const harder = buildGame(buildSeed(id, ALL_TYPES, 20, "BCDFGHJK"));
  const harderScore = scoreLog(harder, harder.questions.map((q) => entry(POKEMON[q.answer].name, 1500))).score;
  check(`${id} scores x${times}`, Math.abs(harderScore - s.score * times) < 25, `${harderScore} vs ${s.score}`);
}
const helped = buildGame(buildSeed("H", ALL_TYPES, 1, "BCDFGHJK"));
const name = POKEMON[helped.questions[0].answer].name;
check(
  "help costs points",
  scoreLog(helped, [entry(name, 1500, { misses: 1, hints: 2 })]).points < scoreLog(helped, [entry(name, 1500)]).points
);

/* ---- Expert's colours ---- */
for (const p of POKEMON) {
  const colors = ART_COLORS[p.id];
  if (!colors?.length) {
    check(`${p.name} has colours`, false);
    continue;
  }
  const sum = colors.reduce((n, [, pc]) => n + pc, 0);
  check(`${p.name} colours add up to 100`, Math.abs(sum - 100) < 0.05, String(sum));
  check(`${p.name} colours are hex`, colors.every(([hex, pc]) => /^#[0-9A-F]{6}$/.test(hex) && pc > 0));
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`quiz ok: ${POKEMON.length} Pokémon, seeds, games, typed answers, logs and scoring.`);
