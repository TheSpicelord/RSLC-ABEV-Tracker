# RSLC ABEV Tracker

Absentee & Early Vote tracker for the November 3, 2026 general election. Interactive national map + state legislative district drill-down showing ABs Requested / Sent / Returned, Early Votes Cast, and Total Votes, each split by modeled party (GOP / Dem / Toss-up) with a net advantage figure (R+ / D+).

## Quick start (local)

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Daily data update (production)

1. Connect to the VPN
2. `python scripts/daily_update.py`
3. Done — the script queries SQL Server, rebuilds `data/abev/`, commits, and pushes; GitHub Pages redeploys automatically.

First-time setup: `pip install pyodbc`, copy `scripts/db_config.template.ini` to `scripts/db_config.ini`, fill in credentials (file is gitignored).

Currently showing **SAMPLE DATA** (randomly generated via `scripts/generate_sample_data.py`) until the SQL pipeline is finalized.

See `CLAUDE.md` for architecture details.
