# RSLC ABEV Tracker

Absentee & Early Vote tracker for the November 3, 2026 general election. Interactive national map + state legislative district drill-down showing ABs Requested, ABs Returned, Early Votes Cast, and Total Votes, each split by modeled party (GOP / Dem / Toss-up) with a net advantage figure (R+ / D+).

Currently loaded with real test data: **Virginia** (March 2026 referendum) and **Wisconsin** (2026 Supreme Court race), matched to their state microtargeting models.

## Quick start (local)

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Daily data update

1. Connect to the VPN
2. `python scripts/daily_update.py`
3. Done — queries SQL Server, rebuilds `data/abev/`, commits, pushes; GitHub Pages redeploys automatically.

First-time setup: `pip install pyodbc`, copy `scripts/db_config.template.ini` to `scripts/db_config.ini`, fill in credentials (gitignored).

See `CLAUDE.md` for architecture, schema, and pipeline details.
