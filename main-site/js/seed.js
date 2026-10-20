// Game seeds. A seed decides everything about a game before it is played:
// which Pokemon come up, in what order, and which wrong names sit beside
// each one. The same seed is always the same game, which is what lets a seed
// be shared and pasted, a replay be packed into a link, and the API check a
// finished game.
//
// Written as "N20-BXK4-M9TR": the difficulty (N normal, H hard, X expert),
// the number of Pokemon, then the eight characters of the seed proper. A
// game limited to some types adds them after a T: "H10-TQ3KF-BXK4-M9TR",
// the four characters being which of the 18 types are in. A bare eight
// characters is a seed too, played with whatever the new-game screen has
// picked.
//
// Integer arithmetic only, as in uwuChess and Flags Match: Math.random would
// make a game come out differently on the server.

import { ALL_TYPES, DIFFICULTIES, isTypeMask, maxCount } from "./rules.js";

// No vowels, and no 0 O 1 I: a seed read aloud cannot be misheard and
// cannot spell a word.
const ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";
const BODY_LENGTH = 8;
const MASK_LENGTH = 4;
export const SEED_MAX = 24;

// 32 bit string hash (cyrb53's mixing, one half of it).
export function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

// mulberry32. Returns unsigned 32 bit integers.
export function randomSource(seedNumber) {
  let a = seedNumber >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function randomBody() {
  // Bytes at or above the limit would make some characters likelier.
  const limit = 256 - (256 % ALPHABET.length);
  let body = "";
  while (body.length < BODY_LENGTH) {
    const [byte] = globalThis.crypto.getRandomValues(new Uint8Array(1));
    if (byte < limit) body += ALPHABET[byte % ALPHABET.length];
  }
  return body;
}

const isBody = (s) => s.length === BODY_LENGTH && [...s].every((c) => ALPHABET.includes(c));

// The type filter as four characters, base 29, and back. 29^4 is more than
// the 2^18 a filter can be.
export function encodeTypes(mask) {
  let out = "";
  for (let i = 0, n = mask; i < MASK_LENGTH; i++, n = Math.floor(n / ALPHABET.length)) out = ALPHABET[n % ALPHABET.length] + out;
  return out;
}

export function decodeTypes(text) {
  if (typeof text !== "string" || text.length !== MASK_LENGTH) return null;
  let n = 0;
  for (const c of text) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) return null;
    n = n * ALPHABET.length + v;
  }
  return isTypeMask(n) ? n : null;
}

// What a seed's type filter is stored as in the database: "all" or the four
// characters.
export const typesKey = (mask) => (mask === ALL_TYPES ? "all" : encodeTypes(mask));

// null when the settings are not a game that can be played.
export function buildSeed(difficulty, types, count, body) {
  if (!DIFFICULTIES.some((d) => d.id === difficulty)) return null;
  if (!isTypeMask(types)) return null;
  if (!Number.isInteger(count) || count < 1 || count > maxCount(types)) return null;
  if (!isBody(body)) return null;
  // Every type is the usual game, so it carries no filter at all, and there
  // is exactly one way to write each seed.
  const filter = types === ALL_TYPES ? "" : `-T${encodeTypes(types)}`;
  const text = `${difficulty}${count}${filter}-${body.slice(0, 4)}-${body.slice(4)}`;
  return { difficulty, types, count, body, text };
}

export function newSeed(difficulty, types, count) {
  return buildSeed(difficulty, types, count, randomBody());
}

// Whatever was typed or pasted, forgiving about case, spaces and dashes.
// A full seed carries its own settings; a bare body takes `fallback`'s.
// Returns { seed } or { error } or null for an empty field.
export function parseSeed(input, fallback = null) {
  const raw = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return null;
  if (raw.length < BODY_LENGTH) return { error: "short" };
  const body = raw.slice(-BODY_LENGTH);
  if (!isBody(body)) return { error: "bad" };
  const prefix = raw.slice(0, -BODY_LENGTH);
  if (!prefix) {
    if (!fallback) return { error: "bad" };
    const seed = buildSeed(fallback.difficulty, fallback.types, fallback.count, body);
    return seed ? { seed, bare: true } : { error: "count" };
  }
  // The count is digits and the filter starts with a T, so neither can run
  // into the other.
  const m = /^([A-Z])(\d{1,3})(?:T([A-Z0-9]{4}))?$/.exec(prefix);
  if (!m) return { error: "bad" };
  const types = m[3] === undefined ? ALL_TYPES : decodeTypes(m[3]);
  // Every type written out as a filter is not the canonical form of any seed.
  if (types === null || (types === ALL_TYPES && m[3] !== undefined)) return { error: "bad" };
  const seed = buildSeed(m[1], types, Number(m[2]), body);
  if (seed) return { seed, bare: false };
  // A real difficulty with more Pokemon than its types have.
  return { error: DIFFICULTIES.some((d) => d.id === m[1]) ? "count" : "bad" };
}

// The canonical text back to a seed, for the API and replay links. null if
// it is not exactly a full seed.
export function seedFromText(text) {
  const parsed = parseSeed(text);
  return parsed?.seed && !parsed.bare && parsed.seed.text === text ? parsed.seed : null;
}
