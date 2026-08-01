# RSLC ABEV Tracker

Interactive map/table tracker of Absentee (AB) and Early Vote (EV) activity for the **November 3, 2026 general election**, by state legislative district. Built for RSLC political research. Derived from the sibling `RSLC-District-Explorer` project (same root folder) — map engine, styling, and architecture are ported from there.

## Running & Deployment

- **No build step** — pure ES6 modules, serve from any static host
- Local dev: serve from the **parent** `Coding Projects` folder (`python -m http.server 8000`), then open `http://localhost:8000/RSLC-ABEV-Tracker/`. Serving from this folder alone works, but the sibling District Explorer data (targets / past leg margins) won't resolve and will fall back to the hosted site.
- Cache busting: `?v=BUILD_VERSION` on JS/CSS imports in `index.html` and `BUILD_VERSION` in `app.js` — bump both when deploying
- Hosted on GitHub Pages from `main` at https://github.com/TheSpicelord/RSLC-ABEV-Tracker

## The Four Stats

Three tracked stats + one calculated: `requested` (RequestDate), `returned` (ReturnDate), `ev` (EarlyVoted), and `voted` = returned + ev (computed client-side, never stored). Ballot-sent is deliberately NOT tracked. Each stat is broken into three modeled-party buckets: `rep`, `dem`, `toss`.

**SIGN CONVENTION — IMPORTANT:** Net = `rep − dem`. **Positive = GOP advantage** (red), negative = Dem (blue). This is *reversed* from District Explorer's DEM_MARGIN convention. Map fill uses `netColor(netPct)` where `netPct = net / total × 100`; the hue saturates at ±20.

## Architecture

```
index.html          # Entry point (topbar controls, map, sidebar)
app.js              # All map/UI logic (~1900 lines)
style.css           # District Explorer theme + "ABEV Tracker additions" section at bottom
modules/
  config.js         # Constants, stat views, AUTH_ENABLED flag, URLs
  dom.js            # DOM element references
  state.js          # Global state object (single source of truth)
  auth.js           # Password gate (Cloudflare Worker) — currently DISABLED via config
data/
  shapes/           # states/house/senate .zip shapefiles (from District Explorer)
  abev/             # GENERATED — do not hand-edit
    <state>_<chamber>.json, national.json, timeline.json, abev_files.json  # 2026 (daily_update.py)
    history/<year>/...  + history.json                                     # 2022/2024 (historical_pull.py)
scripts/
  daily_update.py           # 2026 SQL Server -> JSON -> git push (the whole daily pipeline)
  historical_pull.py        # one-time 2022/2024 general-election backfill (no push loop)
  db_config.template.ini    # Copy to db_config.ini (gitignored) with real creds
```

## SQL Source (VPN required)

Server `dtazclient1.gdtazdata.smartechcorp.net`, database `DTODD_RSLC`, SQL auth (creds in gitignored `scripts/db_config.ini`; driver "ODBC Driver 17 for SQL Server", Encrypt + TrustServerCertificate).

- `dbo.General_Absentees_2026` — one row per voter per election activity. Key columns: `State` (2-letter abbr), `RNC_RegID` (uniqueidentifier — join key to models via `CONVERT(varchar(36), ...)`), `SenateDistrict`/`LegislativeDistrict` (varchar district numbers; may be NULL or '0' = unmatched), `RequestDate`/`ReturnDate`/`EarlyVoted` (date). `BallotSentDate` exists but is unused.
- Model tables (per state, configured in `STATE_MODELS` in daily_update.py; all join on `dt_regid` = text GUID):
  - **VA**: `dbo.RSLC_VA_R2_Exchange_20250804` — `RepublicanFramework_Flag` / `PersuasionFramework_Flag` / `DemocratFramework_Flag` (mutually exclusive 0/1). Persuasion + unmatched → toss.
  - **WI**: `dbo.RGA_WI_ExchangeData_20260131` — `universenumber` 1–8: 1–3 rep, 4–5 toss (swing), 6–8 dem. Unmatched → toss.
  - **National fallback** (`NATIONAL_MODEL_TABLE`): `dbo.[RSLC DRA June National Audiences and Scores]` — 227M rows, one per `dt_regid`. `RSLC Republican / Democratic / Swing Legislative Voters` are mutually exclusive '1'/'0' flags; swing + unmatched → toss. Used by any state with no exchange file of its own (currently AK, RI; ~95% match rate).
- Models are hard classifications (buckets), NOT likelihood scores. Future state models follow the same pattern.
- **Model tables are indexed on `dt_regid`** (covering index INCLUDEing the bucket columns) so the daily aggregate seeks instead of scanning — see `scripts/sql/create_model_indexes.sql`. Model tables are static (a refresh arrives as a brand-new table), so the index persists. **When you point a `STATE_MODELS` entry at a new/refreshed model table, add its index to that file and re-run it**, or that state goes back to a full scan. The AB feed tables are externally owned and deliberately left unindexed.
- `ACTIVE_STATES = ["VA", "WI", "AK", "RI"]`. VA/WI are the spring test states (VA March referendum, WI Supreme Court race) and have full request/return/EV data. **AK and RI are request-only** — every row is a permanent-absentee list signup, zero returns and zero EV, so their Returned/EV/Total views are all zeroes by design. Both use the real Nov 3 election day.
- **AK has no `SenateDistrict`** in the feed (all `'0'`). `alaska_senate_from_house()` derives it: Alaska builds each senate district from two consecutive house districts (A = HD 1–2, B = 3–4, … T = 39–40), matching the shapefile's `00A`–`00T` `SLDUST` values. A state model may set `derive_senate` to any `hd_id -> sd_id` callable to do the same.

### Date edge cases (handled in `timeline_key()`)

- Requests before Jan 1, 2026 = permanent-absentee list signups (some from 2021) → timeline bucket `"pre2026"` (VA is dominated by these)
- Return/EV dates before Jan 1, 2026 or in the future = data entry errors → timeline bucket `"unknown"`
- All rows still count in district/state **totals** regardless of date validity — the buckets only affect the chronological breakdown

## Data Pipeline

Daily flow (on a VPN-connected workstation): `python scripts/daily_update.py`
1. One aggregate query per active state: LEFT JOIN model table, bucket by model, `GROUP BY district pair × stat × bucket × event_date` **server-side** (~100–200k summary rows/state; no individual voter data ever leaves the server)
2. Python rolls up: per-chamber district totals, statewide totals (includes district-unmatched voters), per-date statewide timeline
3. Writes `data/abev/*.json`, then `git add data/abev && commit && push` → GitHub Pages redeploys

Flags: `--no-push` (files only), `--dry-run` (query + summary, no writes), `--states VA,WI`.

### Historical backfill (2022 / 2024)

`python scripts/historical_pull.py` — one-shot (no git push), pulls past **general-election** ABEV from `dbo.General_Absentees_2022` / `_2024`, matching the **same** 2026 state models (moved-away/dead voters simply don't match → `toss`, like any 2026 non-match). Writes the identical record shape under `data/abev/history/<year>/` plus a `history.json` index; the 2026 files are untouched. Flags: `--years 2022,2024`, `--states VA,WI`, `--dry-run`.

- 2022 is filtered to `ElectionType = 'General Election'` (drops runoffs/spring/specials); 2024 is pulled unfiltered (appears general-only). Each is set per-year in `YEAR_CONFIG` (with the year's real cycle-start + election day, not the 2026 spring test dates).
- Prints diagnostics per state/year: ElectionType distribution, model match rate, NULL/0-district share, with hard flags for >5% NULL districts or a whole chamber of empty districts.
- **Caveat for display:** 2022/2024 were federal/presidential cycles — VA had no state-leg race those years, and WI 2022 ran under the pre-2023 map, so district geography won't align with the 2026 map for every state. Counts are real absentee/EV turnout by the voter's district, not legislative-race results.
- **Retired district lines** (`HISTORY_STALE_LINES` in config.js, year → state abbrs; currently `2022: ["VA", "WI"]`): the year's data is still pulled and loaded, but the UI refuses to show it. `historyYearAppliesToSelectedState(year)` marks those column defs `na`, so both the count and margin cells render "N/A" (`historyNaCellHtml`) in every table, that sort key sorts as blank, and `trendYearsForScope()` drops the year so no checkbox or line appears. The columns stay in place on purpose — the years line up with every other state. `legRedistrictingNote()` surfaces the state's `LEG_REDISTRICTING_NOTES` footnote when either the leg-margin column or the past-cycle ABEV column is N/A.

## Data JSON Shapes

Chamber file (`data/abev/va_house.json`):
```json
{ "state_fips": "51", "state_abbr": "VA", "chamber": "house", "updated": "2026-07-18",
  "districts": [ { "district_id": "001",
    "requested": {"rep": 0, "dem": 0, "toss": 0},
    "returned": {...}, "ev": {...},
    "timeline": {"requested": [{"date": "2026-03-06", "rep": 0, "dem": 0, "toss": 0}], "returned": [...], "ev": [...]} } ] }
```
District `timeline` powers the chrono table in the district detail panel (`state.detailChronoMode` = daily/weekly, `state.detailChronoCumulative` = period vs running total).
- `national.json`: `{updated, states: [{state_fips, state_abbr, state_name, requested: {...}, returned, ev}]}` — authoritative statewide totals
- `timeline.json`: `{updated, states: {fips: {stat: [{date, rep, dem, toss}]}}}` — date keys are ISO dates plus `"pre2026"` (first) and `"unknown"` (last). Powers the statewide chrono tables and the trend graph.
- `abev_files.json`: index consumed by the site (`house[]`, `senate[]`, `national`, `timeline`)
- A `"sample": true` flag on national/index would light the topbar SAMPLE DATA badge (no longer used; kept as a safety)

## District Explorer data (targets, incumbents, past leg margins)

Read at runtime from the sibling `RSLC-District-Explorer` project — **never copied into this repo**. Its per-chamber JSONs are generated from `data/State Legislative Election History.xlsx` by that project's `scripts/generate_chamber_jsons.py`; that workbook stays the single source of truth. Regenerate DE's JSON and this site picks it up on reload.

- `DE_DATA_BASES` in `config.js` is tried in order: `../RSLC-District-Explorer/data/` (local, requires serving from the shared parent folder) → `https://districts.rslc.gop/data/` (GitHub Pages fallback). The first base that answers is cached in `state.deBaseUrl`.
- Fetched lazily per `ABBR|chamber` into `state.deDataByKey` (Map of joinKey → DE record) on state select / chamber switch — not all ~99 files upfront.
- **File names come from DE's `chamber_files.json`** (cached in `state.deChamberIndex`), never guessed. Most files are `<abbr>_<chamber>.json`, but MI and MN are `michigan_*` / `minnesota_*` — guessing the name 404s and silently drops those states' targets, incumbents and past margins entirely. Falls back to the guessed name only if the index can't be fetched.
- **Sign flip:** DE stores Dem-positive margins; this project is GOP-positive. `legMarginRPositive()` negates on read. Don't skip this.
- **Tiers** come from the record's `tier` field (1–4; 1–3 in practice). **Offense/Defense is derived, not stored:** R-held = Defense, D-held = Offense, mixed multi-member = Split (`incumbentPartyCode()` → `targetSectionForParty()`).
- **Leg margin columns** are the two most recent `leg_YYYY` values present for that chamber, so odd-year states work (VA → 2023/2025; most → 2022/2024). If only one year exists and `LEG_REDISTRICTING_NOTES` has an entry for the state, the older year renders as an explicit N/A column plus a footnote — WI is the case in hand (redrawn 2023, so 2022 ran under a different map). Senate seats with staggered terms legitimately show N/A for a year they weren't up.

## UI filters

`Up in 2026` (`next_election === 2026`) and `Target Districts` checkboxes in the topbar. Both compute join-key sets in `refreshFilteredDistrictJoinKeySet()`.

**Map and table filter differently — two separate predicates:**
- `districtPassesActiveFilters()` drives the **map**: every active filter applies (intersection). Excluded districts stay drawn but dim (`districtBaseStyle`) and lose their number labels.
- `districtPassesTableFilters()` drives the **sidebar district table**: only Up-in-2026 removes rows. Target-district selection is deliberately map-only, so the table always keeps the full district list.

Inside the Target Districts section, clicking the heading toggles the whole mode, a section header (Defense/Offense/Split) toggles that section, and a tier cell toggles that tier — when targeting is off, the first such click turns it on scoped to just what was clicked. Sections/rows only dim while `targetDistrictsMode` is on; gating dimming on "is this section active" alone washes out the whole section whenever the mode is off.

## Key Concepts (inherited from District Explorer)

- **Join keys**: `"${stateFips}|${districtId}"` (e.g. `"51|001"`) everywhere. District IDs zero-padded to 3; from shapefiles use `SLDLST` (house) / `SLDUST` (senate) TIGER fields. Don't change this format.
- **State object**: all UI state in `modules/state.js`; mutate directly, then call render functions.
- **Render tokens**: `detailsRenderToken`, `districtNumberBuildToken`, `districtLabelRefreshToken` cancel stale async renders.
- **Nebraska**: unicameral — house view shows a "switch to Upper Chamber" message.
- **NH floterial districts**: NOT rendered (shapefile `nh_house_floterial.zip` copied but unused). Known gap vs District Explorer.
- **DC + territories**: filtered out of the map.

## UI Behaviors

- **Three views** (keys 1–3, topbar buttons + clickable sidebar cards): `ab` (Absentee Votes: Requested/Returned columns), `ev` (Early Votes), `abev` (ABEV Totals: Returned/EV/Total — the default). Each view maps to a coloring stat via `VIEW_MAP_STAT` (`returned`/`ev`/`voted`); map + column highlights follow it.
- **Margins are always percentages** of the stat total, positive = R. Two renderings: `formatNetPct` → "R+5.4"/"D+3.2"/"EVEN" (cards, hover, detail), and `marginCellHtml` → DE-style colored cell "+5.4"/"-3.2". Party buckets display as GOP / Dem / **Swing** (data key remains `toss`).
- District tables: raw count columns + margin cells, thin gap columns (`abev-gap-cell`) separating groups, sortable headers pre-split into two lines (count and margin columns sort independently). Headers break so the **year rides the first line with the stat name** ("2024 AB" / "Returned"), keeping each column as narrow as its longest word — `th` is `white-space: nowrap`, so the split in `viewColumnDefs` / `HISTORY_HEAD_LINES` is the only wrap. Both the full district table and the target tables carry a **Dist | Inc** pair; districts with no District Explorer record render Inc blank rather than "O".
- **Chrono views**: Districts / Daily / Weekly buttons in the statewide sidebar under the three stat cards (aqua `active-chrono` style; "Districts" = the plain district table), state mode only, built from `timeline.json` (statewide). Rows newest-first as M/D (weeks as "3/9-3/15", Mon–Sun, ends clamped to the window). Everything outside the state's ABEV window — before it opens (`ABEV_START_OVERRIDES`), after election day (`ELECTION_DAY_OVERRIDES`, default Nov 3), bad/unknown dates, pre-2026 — folds into a single **"Earlier"** row ("Unk" in district detail tables), which is the running-total baseline in cumulative so the newest row equals the all-time total. Switching chamber exits chrono.
  - **Cumulative is a sub-view, not a granularity**: an A/B box under Daily/Weekly toggles `state.chronoCumulative` / `state.detailChronoCumulative` between *Day-to-Day* (*Week-to-Week*) and *Cumulative*. `buildChronoRows(byDate, mode, earlierLabel, cumulative)` buckets by period first, then optionally accumulates — so weekly running totals fall out of the same path. Empty periods are dropped in period mode and kept in cumulative.
- **Past-cycle columns (2022 / 2024)**: **prepended** ahead of the current-cycle columns (e.g. `2022 ABEV Total | 2022 ABEV Margin | gap | 2024 …`), so tables read left-to-right 2022 → 2024 → 2026. Uses the current view's stat (`VIEW_MAP_STAT`), read from `data/abev/history/`. Every table that shows districts or dates gets them via `viewColumnDefs(view, {withHistory:true})` — full district table, target tables, and both chrono tables — so they stay in sync. States with no backfill get no columns at all (`historyAvailableForSelectedState()` guards `viewColumnDefs`), not a wall of "—".
  - **Historical ABEV box** (`None` / `On This Day` / `Final Results`) sits under the Districts/Daily/Weekly row and in the district detail panel. Quiet, vertically stacked, fixed-width `.option-box` styling shared with the cumulative A/B — deliberately lower-contrast than the chrono selector, because both are options on the view above rather than view switches. The width is fixed on purpose: sized to content, the box and its buttons resized whenever the note under them changed. In a chrono view the two boxes sit side by side in an `.option-box-row`. `state.historyMode` is shared across all three panels.
  - **Chrono views drop Final Results** (`historyModeFor({chrono:true})`): a finished total is one number, so it would repeat down every row. A Final chosen in the district table falls back to On This Day inside a chrono view and is restored on the way back.
  - **In chrono tables the alignment is per row**, not one snapshot: each row's own date span maps to the same days-out in the past year (`historyAlignedIso()`), summing that span in period mode or everything through its end in cumulative — so a 4/13–4/19 week in a VA cycle ending 4/21 compares against 10/31–11/6 of 2022. The "Earlier"/"Unk" row has no date to align and renders "—". Statewide chrono reads `history/<year>/timeline.json` (`ensureHistoryTimelines()`, one file per year, all states); district chrono reads the district record's own timeline. Which one is decided by the `joinKey` passed to `chronoTableHtml()` — null means statewide. **`none` is the default**, so the table opens without past cycles. *Final* = the stored all-time totals. *On This Day* = each past year's running total as of the same number of days before **its own** election day (`HISTORY_ELECTION_DAYS`: 2022-11-08, 2024-11-05), so a 102-days-out 2026 compares against 102-days-out 2022/2024.
  - `historyTotalsAsOf()` **excludes undated rows**, unlike the chrono views' "Earlier" baseline — an unknown-dated vote can't be placed in time, and using it as a baseline would report activity before the state's early-vote window even opened (VA 2022 has 29,353 undated but no real ABEV before Sept 19). Cost: at 0 days out On This Day runs under Final by exactly the undated count (~3% in VA). Expect **0** in both years until ~45 days out for VA.
- **Trend graph**: "Trend Graph" tab hangs from the map's upper-right corner (state mode only; faded/disabled in the plain district-table view, hidden nationally). Opens an SVG overlay panel: GOP/Dem/Swing lines (left axis, counts) + dashed net-margin% line (right axis), for the current scope (state chrono view or selected district), current view's stat, and the current granularity + cumulative setting. **Cycle checkboxes (2022 / 2024 / 2026)** pick which cycles to draw — past years are only offered where that scope has a backfill, and 2026 alone is on by default. Past cycles are **shifted onto the current cycle's calendar** by days-out from their own election day (`trendByDateForYear()`), so one x-axis serves all of them; they share the party colors and are told apart by line style (`trendYearStyle()`: 2026 solid, 2024 dashed, 2022 dotted, past years also lighter). Past cycles run the full domain since they're finished; only the current one stops at today. X-axis runs ABEV start → election day; "End graph at current date" checkbox (off by default) shortens it. Auto-closes when scope becomes unavailable (`updateTrendChartUi()`); hover crosshair + tooltip.
- Sidebar headers use proper chamber names from `data/state_chamber_names.json` (`"VA|house"` → "Virginia House of Delegates").
- National view: states colored by statewide net of the view's stat (no data = dimmed); sidebar table US totals row + per-state rows with all four stats (count + margin%), sortable, hover syncs map.
- Click district → detail panel: the same three view cards as the statewide overview (`viewCardsHtml(rec)`, showing that district's totals and switching view on click), then Total/GOP/Dem/Swing/Margin per stat, AB return rate = returned/requested, EV share, stacked bar, then its own chrono section. Chrono/history toggles there redraw the panel with `preserveScroll` — they sit well below the fold.
- Esc: close popup → deselect district → exit chrono → exit to national. Left Shift: toggle chamber. Ctrl+wheel: fine zoom.
- Auth is ON (`AUTH_ENABLED = true` in `modules/config.js`): password gate via the shared District Explorer Cloudflare Worker (`AUTH_WORKER_URL`). Bypassed automatically on `localhost`/`127.0.0.1`, so local dev is unaffected.
