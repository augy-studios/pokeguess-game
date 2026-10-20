#!/usr/bin/env node
// Fails on a PRECACHE entry in main-site/sw.js with no file on disk, on a
// module or stylesheet that exists but is not precached, and on
// art/list.json disagreeing with js/pokemon.js or main-site/art/, since any
// of these is a hole in offline play.
//
// Run: node scripts/check-precache.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "main-site");
const source = readFileSync(join(ROOT, "sw.js"), "utf8");

const block = source.match(/const PRECACHE\s*=\s*\[([\s\S]*?)\n\];/);
if (!block) {
  console.error("could not find the PRECACHE array in main-site/sw.js");
  process.exit(1);
}

const entries = block[1]
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")
  .split("\n")
  .map((line) => line.match(/["']([^"']+)["']/)?.[1])
  .filter(Boolean);

// cleanUrls is on, so "/" is index.html on disk.
const onDisk = (route) => (route === "/" ? "index.html" : route.replace(/^\//, ""));

const seen = new Set();
const missing = [];
const duplicates = [];
for (const route of entries) {
  if (seen.has(route)) duplicates.push(route);
  seen.add(route);
  if (!existsSync(join(ROOT, onDisk(route)))) missing.push(route);
}

const unlisted = [];
for (const [dir, ext] of [["js", ".js"], ["js/vendor", ".js"], ["css", ".css"]]) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const f of readdirSync(full)) {
    if (!f.endsWith(ext)) continue;
    const route = `/${dir}/${f}`;
    if (!seen.has(route)) unlisted.push(route);
  }
}

// The artwork: the worker's list, the data and the files must be one set.
const artProblems = [];
let listed = [];
try {
  listed = JSON.parse(readFileSync(join(ROOT, "art", "list.json"), "utf8"));
} catch {
  artProblems.push("art/list.json is missing or not JSON");
}
if (!source.includes('"/art/list.json"')) artProblems.push("sw.js does not precache from /art/list.json");
const { POKEMON } = await import(pathToFileURL(join(ROOT, "js", "pokemon.js")).href);
const ids = POKEMON.map((p) => p.id);
const files = existsSync(join(ROOT, "art")) ? readdirSync(join(ROOT, "art")).filter((f) => f.endsWith(".webp")).map((f) => Number(f.slice(0, -5))) : [];
for (const id of ids) {
  if (!listed.includes(id)) artProblems.push(`${id}: in pokemon.js, not in art/list.json`);
  if (!files.includes(id)) artProblems.push(`${id}: in pokemon.js, no art/${id}.webp`);
}
for (const id of listed) if (!ids.includes(id)) artProblems.push(`${id}: in art/list.json, not in pokemon.js`);
for (const id of files) if (!ids.includes(id)) artProblems.push(`art/${id}.webp: not in pokemon.js`);

if (duplicates.length) console.error(`duplicate PRECACHE entries:\n  - ${duplicates.join("\n  - ")}`);
if (missing.length) console.error(`PRECACHE entries with no file on disk:\n  - ${missing.join("\n  - ")}`);
if (unlisted.length) console.error(`files the app loads that are not precached:\n  - ${unlisted.join("\n  - ")}`);
if (artProblems.length) console.error(`artwork out of step:\n  - ${artProblems.slice(0, 30).join("\n  - ")}`);

if (missing.length || duplicates.length || unlisted.length || artProblems.length) process.exit(1);

console.log(`precache ok: ${entries.length} entries and ${listed.length} artworks, all present, nothing left out.`);
