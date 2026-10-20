# main-site

What Vercel deploys, served at <https://pokeguessr.uwuapps.org>. No build
step: the files are served as they are, and `api/` holds the serverless
functions.

| Path | What it is |
| --- | --- |
| `index.html` | The only page. Its `<head>` is the template for any page added later. |
| `404.html`, `404.css` | The shared not-found page. |
| `sw.js` | Service worker: the offline shell, every artwork, and the update bar's waiting worker. |
| `manifest.json` | PWA manifest. |
| `art/` | Every Pokémon's official artwork as WebP, and `list.json`, by `scripts/vendor-pokemon.mjs`. |
| `css/theme.css` | The uwuapps theme, verbatim from `uwuapps-theme.md`, time-based mode included. |
| `css/style.css` | Layout, the edge tray, the silhouette, the answers, the replay. |
| `js/` | ES modules, below. |
| `api/` | The leaderboard and replay API, below. |
| `images/` | Manifest screenshots, at the sizes `manifest.json` gives. |

## js

Every file here is precached; `scripts/check-precache.mjs` fails if one is
not. The first six are pure, with no DOM, and the API imports them too, so
the browser and the server always agree on a game.

| File | What it does |
| --- | --- |
| `pokemon.js` | Every Pokémon that can come up, with types, generation, category, family, colour and size. Generated; never edit by hand. |
| `rules.js` | Types, difficulties, game lengths, timing limits, ways to play. |
| `seed.js` | Seeds, and the integer random numbers everything draws from. |
| `quiz.js` | A seed into a game: the Pokémon in order and the names beside each. Typed answer matching, and the hints. |
| `log.js` | A player's answers, packed into a short string for links and the API. |
| `score.js` | Scoring (below). |
| `colors.js` | Each artwork's colours and their shares, for Expert's pie. Generated; never edit by hand. |
| `vendor/chart.umd.min.js` | Chart.js 4.5.1 (MIT), loaded on Expert's first pie. |
| `view.js` | The question on screen: silhouette or pie, names or typing box, and how an answer went. |
| `game.js` | The new-game screen, playing alone, the result, submitting, seeds and replay links. |
| `replay.js` | The instant replay. |
| `net.js` | Pairing over PeerJS, STUN only, from `STUN-p2p-spec.md`. |
| `multiplayer.js` | Games with others on top of `net.js`: hosting, joining, the three ways to play. |
| `qr.js` | QR encoder for the join link, so it works offline. |
| `tray.js` | The edge tray, from `edge-tray-spec.md`. |
| `api.js`, `leaderboard.js`, `settings.js` | The API client, and the leaderboard and settings windows, after MRT Station Guesser's. |
| `theme.js`, `icons.js`, `ui.js`, `update-bar.js`, `app.js` | Theme, inline SVG icons, modal and storage helpers, the update bar, and boot. |

## The game

**Choosing.** A difficulty, 5, 10, 20 or 30 Pokémon (or any number up to
200), and which types: all of them, or any mix, where a Pokémon counts if it
has at least one of the types picked. Nothing comes up twice in a game. The
pool is every species and its distinct forms (regional forms, Megas,
Gigantamax, Primal, Origin and so on), 1,275 in all.

| Difficulty | What is shown | Answers | Points |
| --- | --- | --- | --- |
| Normal | Silhouette | 4 names; none of the wrong ones is a form of the same species | x1 |
| Hard | Silhouette | Typed, as often as you like, with hints | x2.5 |
| Expert | A pie chart of the artwork's colours | Typed, as often as you like, with hints | x4 |

Once an answer is in, the artwork shows in full colour.

**Hard and Expert** leave each Pokémon open until it is answered or skipped.
Each wrong guess takes 15% off what it is worth and each hint 12%, never
below 10%. A guess that names no Pokémon, one already tried, or the right
species in the wrong form ("Vulpix" for Alolan Vulpix) costs nothing and says
which it was. There are seven hints, one at a time: generation and region,
types, category ("the Mouse Pokémon"), its place in its evolution family and
what kind of form it is, its Pokédex colour, height and weight, the shape of
its name, then every other letter. Expert has an eighth: the silhouette,
drawn beside the pie, which moves to a corner to make room. Settings can ask
before each hint.

Typed answers forgive case, accents, punctuation, the order of a form's words
(`alolan vulpix`, `Vulpix-Alola`, `charizard mega x`, `gmax pikachu`), ♀ and ♂
written as f and m, and a slip of a letter or two, as long as the slip is
still nearer that Pokémon than any other.

**Scoring.** Each right answer: 100, plus up to 100 for speed (all of it
within 2, 4 or 5 seconds by difficulty, none by 15, 25 or 30), +10% per
right answer in a row before it up to +50%, and +0% on the first rising to
+100% on the last. Times the difficulty, and times what help is left. A
finished game adds 10 x right answers x accuracy, times the difficulty and
times the game's length: x1 for 5, x1.25 for 10, x1.5 for 20, a quarter more
for each doubling. The API works all of this out again from the log.

**Seeds.** `N20-BXK4-M9TR` is difficulty, count and eight characters; a
type filter adds four more after a T, `H10-TBBBD-BXK4-M9TR`. Shown in a chip
during the game (tap to copy) and with the result. Pasting one on the
new-game screen sets everything it carries; eight characters alone take the
screen's settings. A game on a pasted seed is never scored.

**Replays.** When a game ends it plays back, one Pokémon at a time, each
answer arriving after as long as it took. Play, pause, a step back or
forward, to the start or end, a slider, a list of every Pokémon to jump to,
and 0.5x, 1x, 2x or 4x, remembered, as in wordrain. Share replay gives
`/r/<id>` when the API can store it, and otherwise a link holding the whole
game, `/?watch=<log>&seed=<seed>&mode=<s|r|t|d>`, which opens offline. A
shared replay shows right answers, not points: a link can be edited.

**With others.** Race (everyone answers each Pokémon), Take turns, or Head
to head (two players, first right answer takes it), up to eight devices on
the same wifi or one device's hotspot. One hosts with a six character code,
a link or a QR code. Each Pokémon has 15, 30 or 40 seconds by difficulty.
Each player's own answers are their own game: their replay, their link, and
their own leaderboard entry.

## The anti-cheat

The page plays the game; the API checks it.

1. Starting a game online asks `/api/game/start` for a ticket and a seed the
   server picked. Only those games can be ranked.
2. The artwork is never named in the page: it is fetched as a blob and drawn
   into a canvas as a silhouette, so the answer is not in the DOM.
3. On finishing, the page sends the packed log. The API rebuilds the game
   from the seed, replays the log, and refuses one no person could have
   made: answers faster than 350 ms, typed answers faster than 40 ms a
   character, wrong guesses that could not have been typed in the time,
   more time spent than the server saw pass, answers in someone else's turn,
   or two players both taking the same Pokémon head to head.
4. The score is always the server's, worked out from the log; the page's own
   is never sent.
5. One entry per game, one name per game, and a name cannot have two games
   on the board that were played at the same time.

It cannot stop somebody reading the artwork request in devtools; it is meant
to stop scripted and forged games.

## api

| Endpoint | What it does |
| --- | --- |
| `POST /api/game/start` | A start ticket and a server seed, or a guest's ticket on a host's game |
| `POST /api/game/finish` | Checks and scores a finished log, stopping the server's clock |
| `POST /api/game/submit` | Puts a finished game on the leaderboard under a name |
| `GET /api/leaderboard?board=best\|total` | Best single game per name, or total points per name |
| `POST /api/leaderboard/name` | Checks a name for the settings, under the same rules |
| `POST /api/replay/create` | Stores a replay for a `/r/<id>` link |
| `GET /api/replay?id=` | The replay behind a `/r/<id>` link |

`_lib/verify.js` is the check; `scripts/test-verify.mjs` tests it without a
database.
