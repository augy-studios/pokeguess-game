# PokéGuessr

Name the Pokémon from its silhouette, or from a pie chart of its colours.
Pick a difficulty, how many Pokémon and which types, play alone or with
others on the same network, watch the whole game back as an instant replay,
and share it as a link. Every game has a seed that can be copied and played
again, and games on a seed the server picked can go on a leaderboard.

Live at <https://pokeguessr.uwuapps.org>. A PWA: once opened, it plays
offline, every Pokémon's artwork included.

## What runs where

| Part | Runs on |
| --- | --- |
| `main-site/`, the PWA and its API (`main-site/api/`) | Vercel, root directory `main-site` |
| Database, `pokeguess_*` tables | The shared uwuapps Supabase project |
| Games with others | Browser to browser over WebRTC. PeerJS's public broker introduces the devices; nothing of ours is in between |

There is nothing on the VPS.

## Layout

```text
README.md
migrations/      SQL to run in the Supabase SQL editor, in number order
scripts/         pre-deploy checks, tests, and the data vendoring script
main-site/       the site Vercel deploys, including api/
```

The `uwuapps-*.md`, `update-bar-spec.md`, `edge-tray-spec.md` and
`STUN-p2p-spec.md` files at the root are the specs this is built to.
`main-site/README.md` covers the app itself.

## First setup

1. Run every file in `migrations/`, in number order, in the Supabase SQL
   editor of the shared uwuapps project. Each is safe to run again. **Never
   edit one that has been run**; a change is a new numbered file.
2. On the Vercel project (root directory `main-site`), set the variables in
   `main-site/.env.example`: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
3. Add the domain `pokeguessr.uwuapps.org` to the Vercel project.
4. Deploy.

Without the variables the site still works in full; the API answers
`not_configured`, every game says it is not scored, and Share replay gives
the long link.

## Before every deploy

1. Bump `VERSION` in `main-site/sw.js`. Without it, returning visitors keep
   the previous build and never see the update bar.
2. Run the checks, from the repo root, with Node 20 or later and nothing to
   install:

```text
node scripts/check-sw.mjs          # the worker only activates when asked
node scripts/check-precache.mjs    # everything the app loads, every artwork, works offline
node scripts/check-theme.mjs       # pre-paint script matches js/theme.js
node scripts/test-quiz.mjs         # data, seeds, games, typed answers, logs, scoring
node scripts/test-verify.mjs       # the API's check on a finished game, without a database
```

**If you change `js/pokemon.js`, `js/rules.js`, `js/seed.js`, `js/quiz.js`,
`js/log.js` or `js/score.js`,** seeds and replay links from before the change
may play a different game, and games played on the old build stop verifying:
the API rebuilds every game with the code it has now. Deploy such changes
when a few failed submissions from open tabs are acceptable.

## The data

`scripts/vendor-pokemon.mjs` builds everything the game knows from PokeAPI,
once, by hand, never on deploy:

- `main-site/js/pokemon.js`: every species and the forms that look like
  themselves, with the facts the hints use
- `main-site/art/<id>.webp`: each one's official artwork at 320 px, about
  20 MB in all, plus `art/list.json` for the service worker
- `main-site/js/colors.js`: each artwork's colours and their shares, for
  Expert's pie charts

```text
npm install --no-save --no-package-lock sharp
node scripts/vendor-pokemon.mjs
```

Read its header first: the order of the list is part of every seed, and which
forms are left out (totems, costumes, colour-only and gender variants) is set
there. Bump `VERSION` in `main-site/sw.js` afterwards, and `ART_VERSION` too
if any artwork changed.

The original game asked PokeAPI for every species, one request each, every
time it opened, which is why it took so long to load and why one throttled
request broke it.
