# Poolnews

A small offline site for running your pool: enter everyone's picks, then watch
the standings move week by week. No install, no server, no internet needed once
the data files are built.

## Quick start

Double-click **`pool.html`**. The **Standings** tab is one click away.

Want to see it with data first? Pick **Data ▸ Import JSON** in the header and
choose `sample-pool.json` — 11 poolers with full 12-man rosters. It replaces whatever
is currently saved, so export first if you have real picks in there.

## The site

| Page | What it does |
|---|---|
| `pool.html` | Draft — add poolers, enter and change their 12 picks. |
| `standings.html` | Standings — table, rosters, and the season's progression charts. |
| `funfacts.html` | Fun facts — points per 60 minutes, ice time, and season oddities. |
| `pool-records.html` | Record book — every season since 1994. Built separately; see below. |

All four are reachable from the tab bar in the header of each one.

The first three read and write the **same saved pool**. A page opened from disk
gets the origin `file://` in Chrome, and every local page shares it, so what you
enter on the draft page is what the standings page scores. The record book is
independent of that — it reads only `pool-history.json`.

## Files

| File | What it is |
|---|---|
| `pool.html`, `standings.html`, `funfacts.html` | The three pages. |
| `assets/theme.css` | **The palette and the three faces.** Shared by all four pages, light + dark. |
| `assets/theme.js` | Applies the reader's light/dark choice before the page paints. |
| `assets/site.css` | Component styling for the three app pages. |
| `assets/core.js` | Shared code: player index, saved state, **scoring**, history lookup. |
| `assets/draft.js` | Draft-page code: the search box, the 12 slots. |
| `assets/standings.js` | Standings-page code: table, cards, charts. |
| `assets/funfacts.js` | Fun-facts code: P/60, efficiency charts, odds and ends. |
| `data/players.js` | Every NHL player + season goals/assists. Built by `refresh-players.ps1`. |
| `data/history.js` | Season-to-date goals/assists after each week. Built by `build-history.ps1`. |
| `data/advanced.js` | Ice time, shots, PIM, streaks, home/road. Built by `build-advanced.ps1`. |
| `index.html` | Landing page for the published site; redirects to the standings. |
| `data/pool.js` | The pool as published, so visitors see it. Built by `publish-pool.ps1`. |
| `update.ps1` | **The one to schedule.** Checks for new games, then refreshes what needs it. |
| `publish-pool.ps1` | Bakes poolers + picks into `data/pool.js` for the published site. |
| `refresh-players.ps1` | Re-pulls rosters and stats, rewrites `data/players.js`. |
| `build-history.ps1` | Rebuilds the weekly history behind the progression charts. |
| `build-advanced.ps1` | Rebuilds the per-player ice-time data behind the fun-facts page. |
| `run-selftest.ps1` | Checks the navigation, then runs all three browser suites. Exits 1 on failure. |
| `_selftest.js`, `_selftest-standings.js`, `_selftest-funfacts.js` | The checks those suites run. |
| `sample-pool.json` | A fake but complete pool, for trying things out. |

## The record book (1994–2026)

A page covering the pool's whole history — palmarès, career standings,
trajectories, head-to-heads and every player ever drafted. It is the fourth tab
and now shares the site's bar, palette and fonts (`assets/theme.css`,
`assets/theme.js`), but nothing else: it is written in French, keeps its
newspaper layout, and reads only `pool-history.json`. It has no idea the live
pool exists.

**Edit the template, never `pool-records.html`.** That file is generated;
`build-report.py` overwrites it wholesale on the next run. The nav bar lives in
`pool-records.template.html`, and `run-selftest.ps1` checks it is still there so
a rebuild cannot quietly drop the page out of the site.

| File | What it is |
|---|---|
| `pool-history.json` | **The source of truth.** Hand-edited. 28 seasons, every roster. Facts only — no statistics. |
| `build-report.py` | Applies the scoring rules, checks the file, rebuilds `pool-records.html`. |
| `pool-records.template.html` | The page's markup and styling. `build-report.py` injects the data into it. |
| `pool-records.html` | The finished page. Opens straight from disk, no server, no internet. |

```
py build-report.py        # rebuild after editing pool-history.json
start pool-records.html   # look at it
```

### Adding a season

Copy a `seasons` block in `pool-history.json`, change `year` and `season`, and
list each pooler's 12 picks as `player` / `team` / `pts`, marking defencemen with
`"def": true`. Leave out `counts` and `score` — the builder picks the best 10
(forcing in a defenceman when the top 10 has none) and adds up the total. If you
do write a `score`, it gets checked against the computed one and the build fails
on a mismatch. The `howToAddASeason` key at the top of the file has a worked example.

Two rules the builder enforces on every build: no player owned by two poolers in
the same season, and the counted-pick count matching the season's format.

**Pooler names are stored as `First L.`** — family names are trimmed to an
initial, since the repo is public and the standings carry ten other people's
names. The canonical list lives in the `poolers` block at the top of
`pool-history.json`.

Two things to watch when adding a season:

- **Match the spelling exactly.** The record book keys careers on the name
  string, so `Eric C.` and `Éric C.` would be two different people to it. Copy
  the name from the `poolers` block rather than typing it.
- **One pair needs two letters.** Two different Martins, one who played
  1997–2004 and one from 2011 on, both trim to `Martin P.` — which would fuse
  two careers into a single 19-season one with the wrong titles. They are stored
  as **`Martin Pe.`** and **`Martin Pr.`**. Any future pooler whose first name
  and family initial collide with someone already in the file needs the same
  treatment.

**2025-26 came from the live site**, not from the workbook: the picks are the
imported pool, and the team, position and points for each player come from the
NHL's own season summary. Its `score` was written into the file deliberately so
`build-report.py` recomputes it and fails on any mismatch — it matched all 11.
It is also the first season carrying `"def": true` flags, which is what lets the
builder actually verify the defenceman rule instead of warning that it cannot.

### Where the data came from

`Historique_PoolNews_1994-2025.xlsx` (32 tabs, 1994–2025), converted once by
`build-historique-json.py` → `historique-1994-2025.json` → `migrate-to-source-json.py`.
Every total was recomputed from the player lists and matched against the
`Classement` block on each sheet — 28 seasons, ranks and scores, no discrepancies.
Those three files and the workbook are no longer part of the build and can be deleted.

## Look and feel

Every page carries the same two-line bar: **Poolnews** and the four tabs on the
first line with the three dropdowns (Data / Theme / Auto-refresh) pushed right,
and a small provenance line under it — player count, stats season, and when the
data and the pool were last published. The record book shows the same shape with
its own figures. It is one rule set in `theme.css` targeting one markup shape, so
the bar cannot drift between pages.

Export and Import live in the **Data** dropdown rather than as loose buttons:
they are rare, deliberate actions of the same kind, and three matching
dropdowns read better than dropdowns plus buttons. When the site carries a
published pool, that menu also offers *Reload published pool*.

All four tabs share one design, defined in **`assets/theme.css`** — change a
colour there and it changes everywhere. Nothing else defines a palette.

The system came from the record book, which had the better one: a real
light/dark pair, semantic token names (`--ground`, `--surface`, `--ink`,
`--line`) and three faces — **Big Shoulders Display** for headings, **Newsreader**
for prose, **IBM Plex Mono** for figures. The app pages adopted it and kept
their own density: the draft page is still a compact tool, the standings are
still a dense table.

Two details worth knowing if you edit the CSS:

- **`site.css` keeps the old token names** (`--bg`, `--panel`, `--text`, …) as
  aliases pointing at the semantic ones, so its 147 component rules didn't need
  rewriting. `var()` resolves at use time, so one alias block follows whichever
  theme is active.
- **Chart colours can't come from CSS.** The twelve pooler hues are picked in
  JavaScript (`core.js`), so there are two sets: bright ones for the dark skin,
  deeper ones for light, where the bright ones would wash out. `colorFor()`
  chooses per theme, and the theme switch re-renders the charts.

**Light / dark** — the picker in the header offers auto (follow the OS), light,
or dark. The choice is one localStorage key shared by all four tabs, applied by
`theme.js` in `<head>` so switching pages doesn't flash the wrong theme.

## Pool rules encoded here

- Each pooler drafts **12 players**.
- A player can be owned by **exactly one pooler** — the tool enforces this.
- Scoring: **goals + assists = 1 pt each**, the **best 10** of the 12 count,
  and **at least one defenseman must be among those 10**.

Because of that last rule, the draft page warns you *at the table*:

- 11 picks made and no D yet → "the last pick must be a D"
- 12 picks made and no D at all → this roster can never be scored legally

## Drafting

**Add a pooler** — type a name in the left panel, press Enter or click Add.

**Enter picks** — select a pooler, then type in the search box. It stays
focused, so you can draft a full 12-man roster without touching the mouse:

- type 2+ letters of a first or last name (accents optional — `fransen` finds Fransén)
- `↑` / `↓` to move through matches
- `Enter` to draft the highlighted player
- `Esc` to clear

Matches are ranked last name → first name → anywhere in the name, and within
each group the higher scorer comes first, which is usually the one you meant.

Players already taken show greyed out with the owner's name next to them, and
pressing Enter on one is refused.

**Changing a pick** — press `✎` on a slot. That does *not* delete the player;
it opens a search box right in that slot so you can type a replacement. The
roster never reorders — slot 4 stays slot 4.

- pick someone → replaces the player in that slot
- **Keep** (or `Esc` twice) → cancel, original stays put
- **Empty** → clears just that slot, leaving a gap; the others don't shift up

Empty slots are clickable, and the top search box always fills the first gap —
so if you empty slot 4, the next player you type goes into slot 4.

## Standings

Everything on this page is computed from the picks; nothing there changes them.

**The table** — rank, points, goals, assists, what each pooler gained during
the selected week, how many points they left on the bench, and their best
player. Click any column header to sort by it. Click a **row** to open that
pooler's full 12-man roster: the 10 that count are highlighted, the 2 left off
are faded.

When the top 10 came out all forwards, the row says so — e.g. *"D rule cost 4
pts"* — and the opened roster spells out which defenseman was promoted, who he
displaced, and what it cost.

**As of** — the slider walks the whole season. Everything on the page follows
it: the table, the ranks, the movement arrows, the cards, and the marker line
on the charts. `Latest` jumps back to the end.

**The charts**

- *Points over the season* — each pooler's counting-10 total after every week.
  Hover anywhere to see the whole field ranked at that moment; click to jump the
  page to that week.
- *Position over the season* — the same race drawn as places rather than points,
  which is where the lead changes actually show up.
- *Points gained* — what everyone added during the selected week alone.

Click a name in the legend to hide a pooler, double-click to isolate one.

## Fun facts

The standings say who won. This page says *how* — whether the points came from
talent or from ice time. The measure is **P/60**, points per 60 minutes on the
ice:

```
P/60 = points ÷ seconds on ice × 3600
```

It compares a first-liner playing 22 minutes a night against a third-liner
playing 12. Two points in 20 minutes beats three points in 60. Only each
pooler's **counting 10** are included — the same 10 the standings score.

- **Most efficient players** — every counting player ranked by P/60. Top 25 by
  default; one click shows all 110.
- **Most efficient poolers** — each roster's points over its combined minutes.
- **Ice time vs efficiency** — minutes across, rate up, bubble size = points.
  The upper-left corner is where the bargains live.
- **Points vs minutes** — the table that pairs each pooler's points rank with
  their efficiency rank, plus shots, power-play share and penalty minutes.
- **Odds and ends** — longest point streak, longest drought, most shots, most
  ice time per game, game-winners, PIM, power-play dependence, and who was
  better at home than on the road.

Defensemen sit low on a P/60 list by nature — heavy minutes, fewer points. That
is the measure working, not failing.

## Putting it on the web (GitHub Pages)

The whole site is static files, so GitHub Pages serves it as-is. About 600 KB
ships; the workbook and the one-time conversion scripts are excluded by
`.gitignore`.

### The one thing that has to happen first

Picks live in **your** browser's localStorage. Publish without doing anything
about that and every pooler arrives to an empty pool. So the pool also ships as
a data file:

```powershell
powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\publish-pool.ps1 -PoolFile Pool20252026-import.json
```

That writes `data/pool.js` with a `published` stamp. A browser adopts it when it
has nothing saved, **or when the stamp changes** — so a pooler who once clicked
around the draft page still gets your next update instead of being stuck on
their own copy. The header shows which publication is on screen, with a button
to throw local changes away and go back to it.

Re-run `publish-pool.ps1` whenever the rosters change. It refuses to publish a
pool where two poolers own the same player, and warns about short rosters,
unknown player ids, and rosters with no defenceman.

### First time

```powershell
cd Y:\HockeyPool
git init -b main
git add .
git commit -m "Fantasy hockey pool site"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
A minute later the site is at `https://<you>.github.io/<repo>/`. `index.html`
redirects to the standings, which is what poolers actually want to see.

### Every update after that

```powershell
powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\update.ps1
powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\publish-pool.ps1 -PoolFile Pool20252026-import.json
git add -A
git commit -m "stats through 2026-04-16"
git push
```

The first line refreshes the NHL data, the second only matters when picks
changed. Pages redeploys within a minute of the push.

### Before you push: it will be public

GitHub Pages on a free account requires a **public repository**, so the poolers'
names and rosters are visible to anyone and can be indexed by search engines.
For a hockey pool that is usually fine — but it is a choice, not a detail. The
alternatives:

- **GitHub Pro** — Pages from a private repo.
- **Cloudflare Pages or Netlify** — free tier, serves from a private repo, same
  push-to-deploy flow, costs you one more account.
- **Nicknames** — the pooler name is just a string; nothing requires real ones.

## Saving your data

Picks are stored in your **browser's localStorage**, so they survive closing the
tab — but they're tied to that one browser on that one machine.

Use **Export JSON** to write a real file you can back up or move, and
**Import JSON** to load it back. Do an export after any draft you care about.

## Keeping it up to date during the season

One command does everything:

```powershell
powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\update.ps1
```

It first asks the NHL whether anything has happened since the last run. If no
new game has been recorded, it stops after **three requests, about a second**,
and touches nothing. That is what makes running it often cheap.

When there is something new it picks a gear:

| Gear | What it does | Cost |
|---|---|---|
| **Light** (default) | season goals/assists, plus the week in progress | ~7 requests, ~6 s |
| **Full** (once a day, or `-Full`) | also re-walks all 32 rosters and rebuilds ice time | ~85 requests, ~40 s |

The full gear runs itself whenever the last one was more than `-FullEveryHours`
(default 24) ago, or when the season changes. Add `-WithAdvanced` if you want
the fun-facts numbers refreshed on a light run too; they are season-long
aggregates, so daily is usually enough.

Everything is logged to `update.log`, and each step refuses to write a file that
fails its own checks — so a bad run leaves yesterday's good data in place rather
than half-updating the site.

### How often is worth it

Stats only move when games finish, and the NHL plays at night. A schedule like
this is plenty:

```powershell
# every morning at 7:00
schtasks /Create /TN "HockeyPool update" /TR "powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\update.ps1 -Quiet" /SC DAILY /ST 07:00

# and, if you want the standings to move during game night,
# every 30 minutes between 19:00 and 01:00
schtasks /Create /TN "HockeyPool evening" /TR "powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\update.ps1 -Quiet" /SC MINUTE /MO 30 /ST 19:00 /DU 06:00
```

Going down to every couple of minutes buys nothing: the API publishes a game's
numbers once it is final, not shot by shot, and most runs would exit on the
no-change check anyway. Every 15–30 minutes during games is the sensible floor.

### Watching it live

The pages read their data when they load, so a window left open all evening
keeps showing what was on disk when you opened it. The **Auto-refresh** dropdown
in the header (off by default, remembered per browser) reloads the page every
5, 15 or 60 minutes — pair it with the evening schedule and a screen in the
corner updates itself.

### Running the pieces by hand

```powershell
powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\refresh-players.ps1
powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-history.ps1
powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-advanced.ps1
```

`refresh-players.ps1 -StatsOnly` skips the roster walk and refreshes only
goals/assists; `build-history.ps1 -Incremental` keeps the weeks already on disk
and refetches only the one in progress. Those are the flags the light gear uses.

The first pulls all 32 current rosters plus the season's goals/assists into
`data/players.js` (~1 minute). The second rebuilds `data/history.js`, the
week-by-week snapshots behind the progression charts (~40 seconds). The third
rebuilds `data/advanced.js`, the ice-time data behind the fun-facts page
(~20 seconds).

All of them walk back to the most recent season that actually has data, so once
2026-27 is under way they pick up live numbers on their own. Pin a season with
`-Season 20262027` if you ever need to override that.

### Starting a new season

The 2026-27 regular season opens **2026-09-29**. Until the first games are
played, that season has no rows at all, so the scripts stay on 2025-26 and the
pages keep showing last season's numbers. Nothing to do about that — it sorts
itself out on opening night, when the first update run switches everything over
and `build-history.ps1` starts a fresh set of weekly snapshots.

For the new pool itself:

1. **Export the old one first** — Export JSON, and keep the file. That is the
   only copy of last season once you clear it.
2. On the Draft page, delete the old poolers and add the new ones, then enter
   their 12 picks each.
3. Export again once the draft is done.

Picks live in one browser's storage, so the export is the backup and the way to
move a pool to another machine.

`refresh-players.ps1` includes players who appear in the season's stats but on
no current roster — unsigned free agents, and anyone who has since retired.
Without that, a pool drafted in a past season silently scores zero for them.

### Getting a whole season of game logs in 24 requests

`build-advanced.ps1` needs per-game rows, because time on ice only exists at
that level. The obvious way is one call per player
(`api-web.nhle.com/v1/player/{id}/game-log/…`) — that is 940 requests.

The bulk report does it in 24: `skater/summary` with
`isAggregate=false&isGame=true` returns one row per player per game, and its
cayenne filter accepts `playerId in (…)`, so players are requested in batches.

The trap: `limit=-1` returns everything **up to 10,000 rows**, and
`start=10000` returns nothing at all — you cannot page past the ceiling. Batch
too many players and rows vanish silently. The script keeps batches at 40
players (~3,000 rows) and aborts if any response comes back near the cap.

### Why the data ships as `.js` and not `.json`

A page opened from disk (`file://`) has a null origin, so `fetch()` of a local
`players.json` is blocked by CORS — same as calling the NHL API from the page.
A plain `<script src>` tag, though, loads fine. So the data is written as a
script that assigns `window.NHL_DATA` / `window.NHL_HISTORY`, and both pages
include the same copy.

### How the weekly history is possible at all

The NHL stats API will aggregate per-game rows with a date ceiling
(`isAggregate=true&isGame=true` plus `gameDate<="YYYY-MM-DD"`), which returns
season-to-date totals as of that date. So the history is **backfilled** for the
whole season on the first run — you don't have to start collecting now and wait
for weeks to have a chart.

Two things that bit during that build, both now guarded in the script:

- The API caps a page at 100 rows and returns them in an **unstable order**
  unless you pass an explicit `sort`. Without it, paging through ~850 players
  silently skipped and duplicated rows.
- Windows PowerShell 5.1 serialises some arrays as `{"value":[…],"Count":n}`
  instead of a plain JSON array, which the browser cannot use.

The script refuses to write a file that fails either check, or whose cumulative
totals ever go *down*.

## Running the tests

```powershell
powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\run-selftest.ps1
```

A navigation check across all four pages, then three suites of ~170 checks
driving the real UI in headless Chrome.

The navigation check is plain file inspection: every page must link to the other
three, and every local link must resolve to a file that exists. It covers the
record book, which has no browser suite of its own.

*Draft* covers search ranking, keyboard drafting, keyboard-vs-mouse precedence
in the results list, scroll-into-view, in-place slot editing (replace / keep /
empty, and that neighbours never shift), ownership enforcement, the
no-defenseman warnings, persistence, legacy-format migration, and unknown
player ids.

*Standings* covers the scoring rule in detail — best 10 of 12, the forced-D
swap and its cost, that the *best* bench D is the one promoted, rosters with no
D at all, partial and empty rosters — plus cumulative history sanity, table
sorting and ranking, tied ranks, the roster detail panel, the week selector,
and the chart legend.

*Fun facts* covers the P/60 arithmetic, the leaderboard ordering by rate rather
than by points, the top-25 cap and its "show all" toggle, legend filtering,
table sorting, and rosters containing a player who never dressed. It also pins
real numbers — Kucherov at 5.05 P/60, Seider at 1.71 — which are the figures the
older C++ tool produced for the same season, so a change in how ice time is
fetched or summed shows up as a test failure rather than a quietly different
chart.

### Data shape

`picks` is always a fixed 12-long array with `null` for an empty slot — never a
dense list. That's what keeps slot 4 at slot 4 when you change or clear a pick.
Pools saved in the older dense format are migrated on load, so old exports still
import fine.

### A note on the results list

Rows are built once per query and the selection moves by toggling a class.
Rebuilding the list on every keystroke breaks keyboard navigation: the panel
opens directly under the mouse pointer, so recreating the rows makes the browser
fire mouse events on whichever row sits under the *motionless* cursor, which
resets the selection. If you ever touch that code, keep the rebuild and the
selection repaint separate — there are tests covering it.

## Data source

The NHL's public API, no key required:

- `api-web.nhle.com/v1/standings/now` — team list
- `api-web.nhle.com/v1/roster/{TEAM}/current` — rosters
- `api.nhle.com/stats/rest/en/skater/summary` — skater goals/assists
- `api.nhle.com/stats/rest/en/goalie/summary` — goalie goals/assists
- `api.nhle.com/stats/rest/en/season` — season start/end dates

## Still open

**Should goalies be draftable at all?** They're in the list right now, and their
goals/assists are pulled correctly, but under a pure G+A rule a goalie scores
near zero — so drafting one is self-punishing. Say the word and they can be
filtered out of the search entirely.
