# RSLC ABEV Tracker

Interactive map/table tracker of Absentee (AB) and Early Vote (EV) activity for the **November 3, 2026 general election**, by state legislative district. Built for RSLC political research. Derived from the sibling `RSLC-District-Explorer` project (same root folder) — map engine, styling, and architecture are ported from there.

## Running & Deployment

- **No build step** — pure ES6 modules, serve from any static host
- Local dev: `python -m http.server 8000` then open `http://localhost:8000` (modules require HTTP, not `file://`)
- Cache busting: `?v=BUILD_VERSION` on JS/CSS imports in `index.html` and `BUILD_VERSION` in `app.js` — bump both when deploying
- Hosting target: GitHub Pages (custom domain via `CNAME` later)

## The Five Stats

Four tracked stats + one calculated: `requested`, `sent`, `returned`, `ev` (early votes cast), and `voted` = returned + ev (computed client-side, never stored). Each stat is broken into three modeled-party buckets: `rep`, `dem`, `toss`.

**SIGN CONVENTION — IMPORTANT:** Net = `rep − dem`. **Positive = GOP advantage** (red), negative = Dem (blue). This is *reversed* from District Explorer's DEM_MARGIN convention. Map fill uses `netColor(netPct)` where `netPct = net / total × 100`, capped at ±40.

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
  abev/
    abev_files.json # Index: house[], senate[], national, history URLs
    [st]_house.json / [st]_senate.json   # Per-chamber district counts
    national.json   # Statewide totals per state (authoritative — includes district-unmatched voters)
    history.json    # Daily statewide totals time series (appended each update)
scripts/
  generate_sample_data.py   # SAMPLE data from District Explorer district lists
  daily_update.py           # SQL Server -> JSON -> git push (the real pipeline)
  db_config.template.ini    # Copy to db_config.ini (gitignored) with real creds
  sql/abev_district_aggregate.sql  # Aggregation query TEMPLATE (placeholders!)
```

## Data JSON Shapes

Chamber file (`data/abev/mi_house.json`):
```json
{
  "state_fips": "26", "state_abbr": "MI", "chamber": "house",
  "updated": "2026-07-18", "sample": true,
  "districts": [
    { "district_id": "001",
      "requested": {"rep": 0, "dem": 0, "toss": 0},
      "sent": {...}, "returned": {...}, "ev": {...} }
  ]
}
```
`national.json`: `{updated, sample?, states: [{state_fips, state_abbr, state_name, requested: {...}, sent, returned, ev}]}`.
`history.json`: `{days: [{date, states: {fips: {stat: buckets}}}]}`.
Any `"sample": true` flag lights the SAMPLE DATA badge in the topbar.

## Data Pipeline (the important part)

The website **never talks to SQL**. Daily flow (run on a workstation connected to the VPN):

1. `python scripts/daily_update.py` connects via pyodbc to the SQL Server (creds in gitignored `scripts/db_config.ini`)
2. Runs `scripts/sql/abev_district_aggregate.sql` — joins `dbo.General_Absentees_2026` to microtargeting model tables on the shared voter key (state model preferred, national model fallback via COALESCE), buckets by score, and `GROUP BY district × stat × bucket` **server-side**. Only ~7k aggregate rows return; no individual voter data ever leaves the server.
3. Writes/overwrites `data/abev/*.json`, appends today to `history.json`
4. `git add data/abev && git commit && git push` → GitHub Pages redeploys

**STATUS:** The SQL template still has `<placeholder>` column names. `daily_update.py` refuses to run until they're replaced with the real schema (table/column names of the ABEV table + model tables, and the list of which states have state-level models).

## Key Concepts (inherited from District Explorer)

- **Join keys**: `"${stateFips}|${districtId}"` (e.g. `"26|001"`) everywhere. District IDs zero-padded to 3; from shapefiles use `SLDLST` (house) / `SLDUST` (senate) TIGER fields. Don't change this format.
- **State object**: all UI state in `modules/state.js`; mutate directly, then call render functions.
- **Render tokens**: `detailsRenderToken`, `districtNumberBuildToken`, `districtLabelRefreshToken` cancel stale async renders.
- **Nebraska**: unicameral — house view shows a "switch to Upper Chamber" message; statewide totals come from its senate file.
- **NH floterial districts**: NOT rendered (shapefile `nh_house_floterial.zip` is copied but unused). Known gap vs District Explorer; floterial districts appear in tables only if present in data.
- **DC + territories**: filtered out of the map.

## UI Behaviors

- Stat view buttons (keys 1–5) recolor map + highlight the stat column everywhere
- National view: states colored by statewide net of selected stat; sidebar table US totals row + per-state rows (sortable headers, hover syncs map)
- State view: districts colored by net; sidebar = statewide stat cards + sortable district table; click district → detail panel (bucket table, return rate, EV share, stacked bar)
- Esc: close popup → deselect district → exit to national. Left Shift: toggle chamber. Ctrl+wheel: fine zoom.
- Auth is OFF (`AUTH_ENABLED = false` in `modules/config.js`). To enable: set true (worker URL points at District Explorer's worker; may need its own for a different domain).
