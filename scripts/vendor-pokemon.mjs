#!/usr/bin/env node
// Vendors the game's data, so the site never asks a third party for anything
// at play time, loads at once, and works offline:
//
//   main-site/js/pokemon.js    every species, and the forms that look like
//                              themselves, with what the hints need
//   main-site/art/<id>.webp    each one's official artwork, 320 px WebP
//   main-site/art/list.json    those ids, for the service worker to precache
//   main-site/js/colors.js     each artwork's colours and their shares, for
//                              Expert's pie charts
//
// The original game asked PokeAPI for every species, one request each, every
// time the page opened, which is why it took so long to load and why a single
// throttled request broke it. This asks PokeAPI's GraphQL endpoint once.
//
// Run from the repo root, with Node 20 or later. The artwork is converted
// with sharp, which is only needed here and is never part of the site:
//   npm install --no-save --no-package-lock sharp
//   node scripts/vendor-pokemon.mjs
//
// Downloads are kept in the system temp folder, so a rerun only fetches what
// it has not seen.
//
// The order of POKEMON is part of every seed: a seed picks by place in this
// list. Rerunning this after PokeAPI adds or changes entries moves old seeds
// onto different games, and games played on the old list stop verifying.
// Bump VERSION in main-site/sw.js afterwards, and ART_VERSION too if any
// artwork changed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error("Needs sharp: npm install --no-save --no-package-lock sharp");
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "main-site");
const ART = join(ROOT, "art");
const CACHE = join(tmpdir(), "pokeguessr-art-cache");
const GRAPHQL = "https://graphql.pokeapi.co/v1beta2";
const ART_SIZE = 320;
const ART_QUALITY = 78;
const PARALLEL = 8;

/* ---- which forms play ----
   Every species in its default form, and the forms a silhouette or a pie can
   tell apart from it. Left out: totems, Pikachu's caps and costumes, the
   Let's Go partners, forms that differ only in colour or size (a silhouette
   cannot tell them apart), gender forms (the answer would be the species
   name either way), and a few exact duplicates. */

const LEAVE_OUT = [
  /-totem/,
  /^pikachu-(rock-star|belle|pop-star|phd|libre|cosplay|starter)$/,
  /^pikachu-.*-cap$/,
  /^eevee-starter$/,
  /^greninja-battle-bond$/,
  /^zygarde-(10|50)-power-construct$/,
  /^rockruff-own-tempo$/,
  /^minior-/,
  /^(pumpkaboo|gourgeist)-/,
  /^(koraidon|miraidon)-/,
  /^squawkabilly-/,
  /^basculin-/,
  /^magearna-original/,
  /^ogerpon-/,
  /^maushold-family-of-three$/,
  /^dudunsparce-three-segment$/,
  /-female(-mega)?$/,
];

// Display names PokeAPI words awkwardly.
const RENAME = {
  "darmanitan-galar-standard": "Galarian Darmanitan",
  "darmanitan-galar-zen": "Galarian Zen Darmanitan",
  "meowstic-male-mega": "Mega Meowstic",
  "zygarde-10": "10% Zygarde",
};

const REGIONAL = { alola: "Alolan", galar: "Galarian", hisui: "Hisuian", paldea: "Paldean" };

/* ---- data ---- */

const QUERY = `query {
  pokemon(order_by: {id: asc}) {
    id name height weight is_default pokemon_species_id
    pokemontypes(order_by: {slot: asc}) { type { name } }
    pokemonforms { form_name is_mega pokemonformnames(where: {language_id: {_eq: 9}}) { pokemon_name } versiongroup { generation_id } }
    pokemonsprites { sprites(path: "other.official-artwork.front_default") }
  }
  pokemonspecies(order_by: {id: asc}) {
    id name generation_id evolution_chain_id evolves_from_species_id is_legendary is_mythical
    pokemoncolor { name }
    pokemonspeciesnames(where: {language_id: {_eq: 9}}) { name genus }
  }
}`;

async function fetchData() {
  const res = await fetch(GRAPHQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: QUERY }) });
  if (!res.ok) throw new Error(`PokeAPI GraphQL ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const titleCase = (slug) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function formKind(slug, form) {
  if (form?.is_mega || /-mega(-[xyz])?$/.test(slug)) return "mega";
  if (/-gmax$/.test(slug)) return "gmax";
  if (/-primal$/.test(slug)) return "primal";
  for (const key of Object.keys(REGIONAL)) if (slug.includes(`-${key}`)) return "regional";
  return "alternate";
}

function buildList(data) {
  const species = new Map(data.pokemonspecies.map((s) => [s.id, s]));

  // Evolution: each species' place in its family, and the family's length.
  const depth = new Map();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    const from = species.get(id)?.evolves_from_species_id;
    const d = from ? depthOf(from) + 1 : 1;
    depth.set(id, d);
    return d;
  };
  const chainLength = new Map();
  for (const s of data.pokemonspecies) {
    const d = depthOf(s.id);
    chainLength.set(s.evolution_chain_id, Math.max(chainLength.get(s.evolution_chain_id) ?? 1, d));
  }
  const familySize = new Map();
  for (const s of data.pokemonspecies) familySize.set(s.evolution_chain_id, (familySize.get(s.evolution_chain_id) ?? 0) + 1);

  const out = [];
  for (const p of data.pokemon) {
    const art = p.pokemonsprites?.[0]?.sprites;
    const sp = species.get(p.pokemon_species_id);
    if (!art || !sp) continue;
    if (!p.is_default && LEAVE_OUT.some((re) => re.test(p.name))) continue;

    const spName = sp.pokemonspeciesnames?.[0]?.name || titleCase(sp.name);
    const form = p.pokemonforms?.[0];
    let name;
    let kind = null;
    let gen = sp.generation_id;
    if (p.is_default) {
      name = spName;
    } else {
      name = RENAME[p.name] || form?.pokemonformnames?.[0]?.pokemon_name || titleCase(p.name);
      kind = formKind(p.name, form);
      gen = form?.versiongroup?.generation_id ?? gen;
    }
    name = name.replace(/’/g, "'");

    // Other ways to type it: PokeAPI's slugs, the species name first, and
    // the short forms people use.
    const aliases = new Set([p.name.replace(/-/g, " "), sp.name.replace(/-/g, " ")].filter((a) => p.is_default || a !== sp.name.replace(/-/g, " ")));
    if (!p.is_default) {
      const rest = name.replace(spName, "").replace(/\s+/g, " ").trim();
      if (rest && rest !== name) aliases.add(`${spName} ${rest}`);
      for (const [key, adj] of Object.entries(REGIONAL)) {
        if (p.name.includes(`-${key}`)) {
          aliases.add(`${key} ${spName}`);
          aliases.add(`${spName} ${adj}`);
        }
      }
      if (kind === "gmax") {
        aliases.add(`Gmax ${spName}`);
        aliases.add(`G-Max ${spName}`);
        aliases.add(`${spName} Gigantamax`);
      }
    }
    if (sp.name === "nidoran-f") aliases.add("Nidoran female");
    if (sp.name === "nidoran-m") aliases.add("Nidoran male");
    aliases.delete(name);
    aliases.delete(name.toLowerCase());

    const entry = {
      id: p.id,
      species: sp.id,
      name,
      aliases: [...aliases],
      gen,
      types: p.pokemontypes.map((t) => t.type.name),
      color: sp.pokemoncolor?.name ?? null,
      genus: sp.pokemonspeciesnames?.[0]?.genus ?? null,
      stage: depthOf(sp.id),
      stages: chainLength.get(sp.evolution_chain_id) ?? 1,
      family: familySize.get(sp.evolution_chain_id) ?? 1,
      form: kind,
      rank: sp.is_mythical ? "mythical" : sp.is_legendary ? "legendary" : null,
      height: p.height,
      weight: p.weight,
    };
    out.push({ entry, art });
  }
  // Species order, each species' forms after it.
  out.sort((a, b) => a.entry.species - b.entry.species || a.entry.id - b.entry.id);
  return out;
}

/* ---- artwork ---- */

async function download(url, file) {
  if (existsSync(file)) return readFileSync(file);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, bytes);
      return bytes;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/* ---- colours ----
   Every visible pixel, bucketed, then near colours merged and slivers folded
   into their nearest neighbour, so a pie shows the few colours the eye
   actually sees, outline included. */

const BUCKET_BITS = 4;
const SAME = 48; // RGB distance, out of 441, under which two colours are one
const MIN_SHARE = 0.025;
const MAX_SLICES = 7;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

async function measure(png) {
  const { data, info } = await sharp(png).resize(160, 160, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const shift = 8 - BUCKET_BITS;
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 160) continue;
    const key = ((data[i] >> shift) << (2 * BUCKET_BITS)) | ((data[i + 1] >> shift) << BUCKET_BITS) | (data[i + 2] >> shift);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { n: 0, r: 0, g: 0, b: 0 }));
    b.n++;
    b.r += data[i];
    b.g += data[i + 1];
    b.b += data[i + 2];
    total++;
  }
  // Largest first; each bucket joins the first kept colour near enough.
  let colours = [];
  for (const b of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const rgb = [b.r / b.n, b.g / b.n, b.b / b.n];
    const near = colours.find((c) => dist(c.rgb, rgb) < SAME);
    if (near) {
      near.sum = near.sum.map((v, k) => v + rgb[k] * b.n);
      near.n += b.n;
    } else {
      colours.push({ rgb, sum: rgb.map((v) => v * b.n), n: b.n });
    }
  }
  for (const c of colours) c.rgb = c.sum.map((v) => v / c.n);
  // Slivers fold into the nearest colour that stays.
  colours.sort((x, y) => y.n - x.n);
  const keep = colours.filter((c, i) => i < MAX_SLICES && c.n / total >= MIN_SHARE);
  if (!keep.length) keep.push(colours[0]);
  for (const c of colours) {
    if (keep.includes(c)) continue;
    const to = keep.reduce((best, k) => (dist(k.rgb, c.rgb) < dist(best.rgb, c.rgb) ? k : best));
    to.n += c.n;
  }
  // Percentages to one place that add up to exactly 100.
  const tenths = keep.map((c) => Math.floor((c.n / total) * 1000));
  let left = 1000 - tenths.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % tenths.length, left--) tenths[i]++;
  return keep.map((c, i) => [hex(c.rgb), tenths[i] / 10]).sort((a, b) => b[1] - a[1]);
}

/* ---- run ---- */

mkdirSync(ART, { recursive: true });
mkdirSync(CACHE, { recursive: true });

console.log("Asking PokeAPI for every Pokemon.");
const list = buildList(await fetchData());
console.log(`${list.length} entries.`);

const colours = {};
let done = 0;
let next = 0;
async function worker() {
  while (next < list.length) {
    const { entry, art } = list[next++];
    const png = await download(art, join(CACHE, `${entry.id}.png`));
    const out = join(ART, `${entry.id}.webp`);
    if (!existsSync(out)) {
      await sharp(png).resize(ART_SIZE, ART_SIZE, { fit: "inside" }).webp({ quality: ART_QUALITY, alphaQuality: 90 }).toFile(out);
    }
    colours[entry.id] = await measure(png);
    if (++done % 100 === 0) console.log(`${done} of ${list.length}`);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));

const header = (what) =>
  `// Generated by scripts/vendor-pokemon.mjs from PokeAPI (https://pokeapi.co).\n// Do not edit by hand.\n//\n${what}\n\n`;

writeFileSync(
  join(ROOT, "js", "pokemon.js"),
  header(
    "// One entry per Pokemon that can come up: every species, then its forms.\n" +
      "// The order is part of every seed. id is PokeAPI's, and names the artwork\n" +
      "// in /art/. height is in decimetres and weight in hectograms, as PokeAPI\n" +
      "// gives them. stage is the place in its evolution family of `stages`."
  ) +
    "export const POKEMON = [\n" +
    list.map(({ entry }) => `  ${JSON.stringify(entry)},`).join("\n") +
    "\n];\n"
);

writeFileSync(
  join(ROOT, "js", "colors.js"),
  header("// Each artwork's colours, largest first, with the percentage of the\n// Pokemon each covers: { id: [[hex, percent], ...] }.") +
    "export const ART_COLORS = {\n" +
    list.map(({ entry }) => `  ${entry.id}: ${JSON.stringify(colours[entry.id])},`).join("\n") +
    "\n};\n"
);

// What the service worker precaches into its artwork cache.
writeFileSync(join(ART, "list.json"), JSON.stringify(list.map(({ entry }) => entry.id)) + "\n");

console.log(`Wrote js/pokemon.js, js/colors.js, art/list.json and ${list.length} artworks.`);
