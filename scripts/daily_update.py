"""Daily ABEV update: SQL Server -> data/abev/*.json -> git push -> live site.

Morning routine (while connected to the VPN):

    python scripts/daily_update.py            # full update + git commit/push
    python scripts/daily_update.py --no-push  # update files only, no git
    python scripts/daily_update.py --dry-run  # test SQL connection + query, write nothing

Configuration lives in scripts/db_config.ini (NOT committed — see
scripts/db_config.template.ini). Requires: pip install pyodbc

The aggregation query (scripts/sql/abev_district_aggregate.sql) does all the
heavy lifting server-side and returns only district x stat x party-bucket
counts, so no individual-level voter data ever reaches this machine or the
website repo.

STATUS: skeleton — the SQL template still has <placeholder> column names that
must be filled in once we confirm the schema of dbo.General_Absentees_2026 and
the model tables.
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
SQL_PATH = PROJECT_ROOT / "scripts" / "sql" / "abev_district_aggregate.sql"
OUT_DIR = PROJECT_ROOT / "data" / "abev"

STATS = ("requested", "sent", "returned", "ev")
BUCKETS = ("rep", "dem", "toss")

FIPS_TO_ABBR = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
    "09": "CT", "10": "DE", "12": "FL", "13": "GA", "15": "HI", "16": "ID",
    "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA",
    "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
    "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ",
    "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK",
    "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN",
    "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
    "55": "WI", "56": "WY",
}

ABBR_TO_NAME = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska",
    "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
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
        "TrustServerCertificate=yes;"
    )
    print(f"Connecting to {cfg['server']} / {cfg['database']} ...")
    return pyodbc.connect(conn_str, timeout=30)


def run_aggregate_query(conn):
    sql = SQL_PATH.read_text(encoding="utf-8")
    if "<" in sql.split("--", 1)[0] or "<voter_key>" in sql:
        sys.exit(
            "scripts/sql/abev_district_aggregate.sql still contains <placeholder> column names.\n"
            "Fill in the real schema before running the daily update."
        )
    cursor = conn.cursor()
    cursor.execute(sql)
    rows = cursor.fetchall()
    print(f"Query returned {len(rows):,} aggregate rows.")
    return rows


def normalize_fips(value):
    digits = "".join(c for c in str(value or "") if c.isdigit())
    return digits.zfill(2) if digits else ""


def normalize_district_id(value):
    raw = str(value or "").strip().upper()
    if not raw:
        return ""
    if raw.isdigit():
        return raw.zfill(3)
    return raw.replace(" ", "")


def build_outputs(rows, updated):
    """rows: (state_fips, chamber, district_id, stat, bucket, n)"""
    # districts[fips][chamber][district_id][stat][bucket] = n
    districts = defaultdict(lambda: defaultdict(lambda: defaultdict(
        lambda: {s: {b: 0 for b in BUCKETS} for s in STATS})))
    statewide = defaultdict(lambda: {s: {b: 0 for b in BUCKETS} for s in STATS})

    for row in rows:
        fips = normalize_fips(row[0])
        chamber = str(row[1] or "").strip().lower()
        stat = str(row[3] or "").strip().lower()
        bucket = str(row[4] or "").strip().lower()
        n = int(row[5] or 0)
        if not fips or fips not in FIPS_TO_ABBR or stat not in STATS or bucket not in BUCKETS:
            continue
        if chamber == "statewide":
            statewide[fips][stat][bucket] += n
            continue
        if chamber not in ("house", "senate"):
            continue
        did = normalize_district_id(row[2])
        if not did:
            continue
        districts[fips][chamber][did][stat][bucket] += n

    out_index = {"house": [], "senate": []}
    for fips in sorted(districts):
        abbr = FIPS_TO_ABBR[fips]
        for chamber in ("house", "senate"):
            dmap = districts[fips].get(chamber)
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

    states_out = []
    for fips in sorted(statewide):
        abbr = FIPS_TO_ABBR[fips]
        states_out.append({
            "state_fips": fips,
            "state_abbr": abbr,
            "state_name": ABBR_TO_NAME.get(abbr, abbr),
            **statewide[fips],
        })
    national = {"updated": updated, "states": states_out}
    (OUT_DIR / "national.json").write_text(json.dumps(national, separators=(",", ":")), encoding="utf-8")

    append_history(statewide, updated)

    index_out = {
        "updated": updated,
        **out_index,
        "national": "data/abev/national.json",
        "history": "data/abev/history.json",
    }
    (OUT_DIR / "abev_files.json").write_text(json.dumps(index_out, indent=2), encoding="utf-8")

    print(f"Wrote {len(out_index['house'])} house + {len(out_index['senate'])} senate files, "
          f"{len(states_out)} states in national.json.")


def append_history(statewide, updated):
    history_path = OUT_DIR / "history.json"
    history = {"days": []}
    if history_path.exists():
        try:
            history = json.loads(history_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    if history.get("sample"):
        # First real update replaces sample history entirely.
        history = {"days": []}

    day_states = {fips: dict(stats) for fips, stats in statewide.items()}
    days = [d for d in history.get("days", []) if d.get("date") != updated]
    days.append({"date": updated, "states": day_states})
    days.sort(key=lambda d: d.get("date", ""))
    history_path.write_text(json.dumps({"days": days}, separators=(",", ":")), encoding="utf-8")
    print(f"History now covers {len(days)} days.")


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
    parser.add_argument("--dry-run", action="store_true", help="connect and run the query, write nothing")
    args = parser.parse_args()

    updated = date.today().isoformat()
    cfg = load_config()
    conn = connect(cfg)
    try:
        rows = run_aggregate_query(conn)
    finally:
        conn.close()

    if args.dry_run:
        print("Dry run complete — no files written.")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build_outputs(rows, updated)

    if args.no_push:
        print("Skipping git publish (--no-push).")
        return
    git_publish(updated)


if __name__ == "__main__":
    main()
