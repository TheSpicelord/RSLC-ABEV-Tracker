"""Daily ABEV update: SQL Server -> data/abev/*.json -> git push -> live site.

Morning routine (while connected to the VPN):

    python scripts/daily_update.py            # full update + git commit/push
    python scripts/daily_update.py --no-push  # update files only, no git
    python scripts/daily_update.py --dry-run  # test SQL connection + queries, write nothing

Configuration lives in scripts/db_config.ini (NOT committed — see
scripts/db_config.template.ini). Requires: pip install pyodbc

All aggregation happens server-side (GROUP BY district/stat/bucket); only
summary counts come back, so no individual-level voter data ever reaches this
machine's repo or the website.

Tracked stats: requested (RequestDate), returned (ReturnDate), ev (EarlyVoted).
"Total votes" (returned + ev) is computed client-side by the site.

Party buckets come from state model tables (see STATE_MODELS). Voters not
matched to a model, or in a persuasion/swing segment, count as 'toss'.

Date handling:
  * requested before Jan 1, 2026 -> timeline bucket "pre2026" (permanent
    absentee list signups); still counted in district/state totals
  * returned/ev before Jan 1, 2026, or any date in the future, or NULL ->
    timeline bucket "unknown"; still counted in totals
"""

import argparse
import configparser
import json
import subprocess
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "scripts" / "db_config.ini"
OUT_DIR = PROJECT_ROOT / "data" / "abev"

ABEV_TABLE = "dbo.General_Absentees_2026"
STATS = ("requested", "returned", "ev")
BUCKETS = ("rep", "dem", "toss")
CYCLE_START = date(2026, 1, 1)

# Per-state model configuration. bucket_sql must yield 'rep' / 'dem' / 'toss'
# for a LEFT-JOINed model row alias `m` (NULL columns when unmatched).
# When more states come online, add them here. States without their own model
# will eventually fall back to a national model (not yet wired up).
# election_day: timeline dates after this fold into "unknown" (the spring test
# elections end in April; real 2026 general states use Nov 3).
DEFAULT_ELECTION_DAY = date(2026, 11, 3)

STATE_MODELS = {
    "VA": {
        "model_table": "dbo.RSLC_VA_R2_Exchange_20250804",
        "join_col": "dt_regid",
        "election_day": date(2026, 4, 21),  # spring referendum (test data)
        "bucket_sql": (
            "CASE WHEN m.RepublicanFramework_Flag = 1 THEN 'rep' "
            "WHEN m.DemocratFramework_Flag = 1 THEN 'dem' "
            "ELSE 'toss' END"  # PersuasionFramework_Flag=1 and unmatched -> toss
        ),
    },
    "WI": {
        "model_table": "dbo.RGA_WI_ExchangeData_20260131",
        "join_col": "dt_regid",
        "election_day": date(2026, 4, 7),  # spring Supreme Court (test data)
        "bucket_sql": (
            "CASE WHEN m.universenumber BETWEEN 1 AND 3 THEN 'rep' "
            "WHEN m.universenumber BETWEEN 6 AND 8 THEN 'dem' "
            "ELSE 'toss' END"  # 4-5 = swing; unmatched -> toss
        ),
    },
}

# States to pull. RI and AK currently only contain permanent-absentee list
# signups with no models — ignore until real 2026 general data arrives.
ACTIVE_STATES = ["VA", "WI"]

ABBR_TO_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "FL": "12", "GA": "13", "HI": "15", "ID": "16",
    "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22",
    "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28",
    "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33", "NJ": "34",
    "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40",
    "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46", "TN": "47",
    "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54",
    "WI": "55", "WY": "56",
}

ABBR_TO_NAME = {
    "VA": "Virginia", "WI": "Wisconsin", "RI": "Rhode Island", "AK": "Alaska",
    "AL": "Alabama", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida",
    "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "WA": "Washington",
    "WV": "West Virginia", "WY": "Wyoming",
}


def load_config():
    if not CONFIG_PATH.exists():
        sys.exit(
            f"Missing {CONFIG_PATH}.\n"
            "Copy scripts/db_config.template.ini to scripts/db_config.ini and fill in credentials."
        )
    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_PATH, encoding="utf-8")
    return cfg["sqlserver"]


def connect(cfg):
    import pyodbc

    driver = cfg.get("driver", "ODBC Driver 17 for SQL Server")
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={cfg['server']};"
        f"DATABASE={cfg['database']};"
        f"UID={cfg['username']};"
        f"PWD={cfg['password']};"
        "Encrypt=yes;TrustServerCertificate=yes;"
    )
    print(f"Connecting to {cfg['server']} / {cfg['database']} ...")
    return pyodbc.connect(conn_str, timeout=30)


def state_query(model):
    """One aggregate query per state: counts by district pair, stat, bucket, event date."""
    return f"""
WITH scored AS (
    SELECT
        a.LegislativeDistrict AS hd,
        a.SenateDistrict AS sd,
        a.RequestDate,
        a.ReturnDate,
        a.EarlyVoted,
        {model['bucket_sql']} AS bucket
    FROM {ABEV_TABLE} a
    LEFT JOIN {model['model_table']} m
        ON m.{model['join_col']} = CONVERT(varchar(36), a.RNC_RegID)
    WHERE a.State = ?
),
events AS (
    SELECT hd, sd, bucket, 'requested' AS stat, RequestDate AS event_date FROM scored WHERE RequestDate IS NOT NULL
    UNION ALL
    SELECT hd, sd, bucket, 'returned', ReturnDate FROM scored WHERE ReturnDate IS NOT NULL
    UNION ALL
    SELECT hd, sd, bucket, 'ev', EarlyVoted FROM scored WHERE EarlyVoted IS NOT NULL
)
SELECT hd, sd, bucket, stat, event_date, COUNT(*) AS n
FROM events
GROUP BY hd, sd, bucket, stat, event_date
"""


def normalize_district_id(value):
    raw = str(value or "").strip().upper()
    if not raw or raw == "0" or raw == "NONE":
        return ""
    if raw.isdigit():
        return raw.zfill(3)
    return raw.replace(" ", "")


def timeline_key(stat, event_date, today, election_day):
    """Chronological bucket for an event date (see module docstring)."""
    if not isinstance(event_date, date):
        return "unknown"
    if event_date > today or event_date > election_day:
        return "unknown"
    if event_date < CYCLE_START:
        return "pre2026" if stat == "requested" else "unknown"
    return event_date.isoformat()


def empty_stat_buckets():
    return {s: {b: 0 for b in BUCKETS} for s in STATS}


def pull_state(conn, abbr, today):
    model = STATE_MODELS[abbr]
    print(f"[{abbr}] running aggregate query (model: {model['model_table']}) ...")
    cursor = conn.cursor()
    cursor.execute(state_query(model), abbr)
    rows = cursor.fetchall()
    print(f"[{abbr}] {len(rows):,} aggregate rows returned.")

    house = defaultdict(empty_stat_buckets)
    senate = defaultdict(empty_stat_buckets)
    statewide = empty_stat_buckets()
    timeline = {s: defaultdict(lambda: {b: 0 for b in BUCKETS}) for s in STATS}

    for hd, sd, bucket, stat, event_date, n in rows:
        bucket = str(bucket or "").strip()
        stat = str(stat or "").strip()
        if bucket not in BUCKETS or stat not in STATS:
            continue
        n = int(n or 0)
        hd_id = normalize_district_id(hd)
        sd_id = normalize_district_id(sd)
        if hd_id:
            house[hd_id][stat][bucket] += n
        if sd_id:
            senate[sd_id][stat][bucket] += n
        statewide[stat][bucket] += n
        election_day = model.get("election_day", DEFAULT_ELECTION_DAY)
        timeline[stat][timeline_key(stat, event_date, today, election_day)][bucket] += n

    return house, senate, statewide, timeline


def timeline_rows(timeline_stat):
    """Sorted timeline: pre2026 first, then dates ascending, unknown last."""
    def order(key):
        if key == "pre2026":
            return (0, "")
        if key == "unknown":
            return (2, "")
        return (1, key)

    return [
        {"date": key, **timeline_stat[key]}
        for key in sorted(timeline_stat, key=order)
    ]


def build_outputs(results, updated):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_index = {"house": [], "senate": []}
    states_out = []
    timeline_out = {}

    for abbr in sorted(results):
        fips = ABBR_TO_FIPS[abbr]
        house, senate, statewide, timeline = results[abbr]

        for chamber, dmap in (("house", house), ("senate", senate)):
            if not dmap:
                continue
            out = {
                "state_fips": fips,
                "state_abbr": abbr,
                "chamber": chamber,
                "updated": updated,
                "districts": [
                    {"district_id": did, **dmap[did]} for did in sorted(dmap)
                ],
            }
            path = OUT_DIR / f"{abbr.lower()}_{chamber}.json"
            path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
            out_index[chamber].append(f"data/abev/{path.name}")

        states_out.append({
            "state_fips": fips,
            "state_abbr": abbr,
            "state_name": ABBR_TO_NAME.get(abbr, abbr),
            **statewide,
        })
        timeline_out[fips] = {stat: timeline_rows(timeline[stat]) for stat in STATS}

    (OUT_DIR / "national.json").write_text(
        json.dumps({"updated": updated, "states": states_out}, separators=(",", ":")),
        encoding="utf-8",
    )
    (OUT_DIR / "timeline.json").write_text(
        json.dumps({"updated": updated, "states": timeline_out}, separators=(",", ":")),
        encoding="utf-8",
    )
    (OUT_DIR / "abev_files.json").write_text(
        json.dumps(
            {
                "updated": updated,
                **out_index,
                "national": "data/abev/national.json",
                "timeline": "data/abev/timeline.json",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Wrote {len(out_index['house'])} house + {len(out_index['senate'])} senate files, "
          f"{len(states_out)} states in national.json + timeline.json.")


def git_publish(updated):
    def run(*args):
        result = subprocess.run(["git", *args], cwd=PROJECT_ROOT, capture_output=True, text=True)
        if result.returncode != 0:
            sys.exit(f"git {' '.join(args)} failed:\n{result.stderr}")
        return result.stdout

    status = run("status", "--porcelain", "data/abev")
    if not status.strip():
        print("No data changes to publish.")
        return
    run("add", "data/abev")
    run("commit", "-m", f"Daily ABEV update {updated}")
    run("push")
    print("Pushed to remote — site will redeploy shortly.")


def main():
    parser = argparse.ArgumentParser(description="Daily ABEV data update")
    parser.add_argument("--no-push", action="store_true", help="update files but skip git commit/push")
    parser.add_argument("--dry-run", action="store_true", help="connect and run queries, write nothing")
    parser.add_argument("--states", default=",".join(ACTIVE_STATES),
                        help="comma-separated state abbrs to pull (default: %(default)s)")
    args = parser.parse_args()

    states = [s.strip().upper() for s in args.states.split(",") if s.strip()]
    for abbr in states:
        if abbr not in STATE_MODELS:
            sys.exit(f"No model configured for {abbr} — add it to STATE_MODELS in {__file__}")

    today = date.today()
    updated = today.isoformat()
    cfg = load_config()
    conn = connect(cfg)
    try:
        results = {abbr: pull_state(conn, abbr, today) for abbr in states}
    finally:
        conn.close()

    if args.dry_run:
        for abbr, (house, senate, statewide, _timeline) in results.items():
            print(f"[{abbr}] house districts: {len(house)}, senate districts: {len(senate)}, "
                  f"statewide requested: {sum(statewide['requested'].values()):,}")
        print("Dry run complete — no files written.")
        return

    build_outputs(results, updated)

    if args.no_push:
        print("Skipping git publish (--no-push).")
        return
    git_publish(updated)


if __name__ == "__main__":
    main()
