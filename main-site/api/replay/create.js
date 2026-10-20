// POST /api/replay/create  { seed, log, mode } -> { id }
//
// Keeps a replay under eight characters, so the page can share /r/<id>
// rather than a link carrying the whole game. The same three things a long
// link carries, and nothing else: no name, no score. Stored only once the
// log reads against its seed, so nothing but a real replay can be put
// behind a link on this site. The same game shared again gets the same id.

import { randomInt, createHash } from "node:crypto";
import { endpoint, HttpError, limit } from "../_lib/http.js";
import { rest } from "../_lib/supabase.js";
import { readLog } from "../_lib/verify.js";
import { seedFromText } from "../../js/seed.js";
import { buildGame } from "../../js/quiz.js";
import { unpackLog } from "../../js/log.js";

const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const ID_LENGTH = 8;
const MODES = ["s", "r", "t", "d"];

const newId = () => Array.from({ length: ID_LENGTH }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");

export default endpoint("POST", async ({ req, body }) => {
  const seed = seedFromText(typeof body.seed === "string" ? body.seed : "");
  if (!seed) throw new HttpError(400, "bad_seed", "That is not a seed.");
  const log = readLog(body.log);
  const mode = MODES.includes(body.mode) ? body.mode : "s";
  if (!unpackLog(log, buildGame(seed))) throw new HttpError(400, "bad_replay", "That is not a replay of that seed.");

  await limit(req, "replay", 600, 30);

  const digest = createHash("sha256").update(`${seed.text}|${mode}|${log}`).digest("hex");
  const [existing] = (await rest(`pokeguess_replays?digest=eq.${digest}&select=id`)) ?? [];
  if (existing) return { id: existing.id };

  // Eight characters from 55 make a clash vanishingly rare, but a second try
  // costs nothing. A clash on the digest is the same replay shared twice at
  // once: the other request's id is the answer.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId();
    try {
      await rest("pokeguess_replays", { method: "POST", body: { id, digest, seed: seed.text, log, mode } });
      return { id };
    } catch (err) {
      if (!/supabase 409/.test(err.message ?? "")) throw err;
      const [row] = (await rest(`pokeguess_replays?digest=eq.${digest}&select=id`)) ?? [];
      if (row) return { id: row.id };
    }
  }
  throw new HttpError(503, "busy", "Could not store the replay. Share the long link instead.");
});
