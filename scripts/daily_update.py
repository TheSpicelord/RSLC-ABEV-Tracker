"""Daily ABEV update: SQL Server -> data/abev/*.json -> git push -> live site.

Morning routine (while connected to the VPN):

    python scripts/daily_update.py            # full update + git commit/push
    python scripts/daily_update.py --no-push  # update files only, no git
    python scripts/daily_update.py --dry-run  # test SQL connection + queries, write nothing
    python scripts/daily_update.py --workers 8  # more parallel state queries
    python scripts/daily_update.py --force    # re-pull every state, ignore the skip-unchanged cache

States are pulled in parallel (one connection each, --workers controls how many
at once). A cheap per-state fingerprint (row count + latest activity dates) is
compared against the last run's cache, and unchanged states are reused from the
existing JSON on disk instead of re-queried — --force overrides that.

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
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from queue import Queue

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "scripts" / "db_config.ini"
OUT_DIR = PROJECT_ROOT / "data" / "abev"
# Per-state fingerprints from the last successful run (gitignored). Lets an
# unchanged state be skipped instead of re-queried (#4). See state_watermark().
WATERMARK_PATH = PROJECT_ROOT / "scripts" / ".abev_watermarks.json"
DEFAULT_WORKERS = 4

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

# National fallback model for states with no state-specific exchange file.
# The three RSLC legislative audiences are mutually exclusive across the file
# (verified: every row is exactly one of rep / dem / swing), so this buckets the
# same way a state model does. Swing and unmatched -> toss.
NATIONAL_MODEL_TABLE = "dbo.[RSLC DRA June National Audiences and Scores]"
NATIONAL_BUCKET_SQL = (
    "CASE WHEN m.[RSLC Republican Legislative Voters] = '1' THEN 'rep' "
    "WHEN m.[RSLC Democratic Legislative Voters] = '1' THEN 'dem' "
    "ELSE 'toss' END"
)


def alaska_senate_from_house(hd_id):
    """AK's ABEV feed has no SenateDistrict, but Alaska statute builds each
    senate district from two consecutive house districts: A = HD 1-2,
    B = 3-4, ... T = 39-40. Shapefile SLDUST values are '00A'..'00T'."""
    if not hd_id.isdigit():
        return ""
    n = int(hd_id)
    if not 1 <= n <= 40:
        return ""
    return "00" + chr(ord("A") + (n - 1) // 2)


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
    # Alaska has its own statewide DSP model (Sullivan vs Peltola, the 2026 U.S.
    # Senate race): framework = 'Sullivan' -> rep, 'Peltola' -> dem, everything
    # else ('Persuasion' + unmatched) -> toss, exactly like every other state
    # model. This is AK's permanent lean model for BOTH the Aug 18 primary and
    # the Nov 3 general.
    #
    # AK is *temporarily* pointed at its PRIMARY feed (Primary_Absentees_2026,
    # State='AK', no ElectionType filter) with an 8/18 election day; derive_senate
    # fills in the senate district the AK feed omits. To retire the primary
    # bolt-on for the general: delete abev_table + election_day here (restoring
    # the General-feed / Nov 3 default) and the "02" overrides in config.js, but
    # KEEP model_table + bucket_sql — the DSP model carries straight over.
    "AK": {
        "abev_table": "dbo.Primary_Absentees_2026",
        "election_day": date(2026, 8, 18),
        "model_table": "vs.ak_scores_audiences_20260721",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.framework = 'Sullivan' THEN 'rep' "
            "WHEN m.framework = 'Peltola' THEN 'dem' "
            "ELSE 'toss' END"  # 'Persuasion' and unmatched -> toss
        ),
        "derive_senate": alaska_senate_from_house,
    },
    "RI": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    # Pennsylvania: real Nov 3 general (default election day), pulled from the
    # General feed. State exchange model buckets by UniverseNumber 1-7:
    # 1-2 (Rep Base / Rep Bring Home) -> rep, 6-7 (Dems Going Home / Dem Base)
    # -> dem, 3-5 (Prime Persuasion / Stubborn Middle / Dem Peel) + unmatched
    # -> toss.
    "PA": {
        "model_table": "dbo.PA_RSLC_R1_Exchange_20260418",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.UniverseNumber IN (1, 2) THEN 'rep' "
            "WHEN m.UniverseNumber IN (6, 7) THEN 'dem' "
            "ELSE 'toss' END"  # 3-5 (persuasion/swing) and unmatched -> toss
        ),
    },
}

ACTIVE_STATES = ["VA", "WI", "AK", "RI"]
# PA is wired in STATE_MODELS + indexed and ready, but held out of ACTIVE_STATES
# until its 2026 general data returns to dbo.General_Absentees_2026 (the vendor
# feed dropped it after briefly loading ~526k rows). Add "PA" here to activate.
# (The Michigan Aug 4 primary bolt-on was removed after that election; its model
# will be refreshed as a new table for the general.)

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


def fmt_dur(seconds):
    """Human-friendly elapsed time: '42s' or '3m12s'."""
    seconds = int(round(seconds))
    if seconds < 60:
        return f"{seconds}s"
    return f"{seconds // 60}m{seconds % 60:02d}s"


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
    """One aggregate query per state: counts by district pair, stat, bucket, event date.

    Source table and an optional extra WHERE filter are per-state (default: the
    General feed, no filter). MI's temporary primary bolt-on overrides both."""
    table = model.get("abev_table", ABEV_TABLE)
    extra_where = model.get("extra_where", "")
    return f"""
WITH scored AS (
    SELECT
        a.LegislativeDistrict AS hd,
        a.SenateDistrict AS sd,
        a.RequestDate,
        a.ReturnDate,
        a.EarlyVoted,
        {model['bucket_sql']} AS bucket
    FROM {table} a
    LEFT JOIN {model['model_table']} m
        ON m.{model['join_col']} = CONVERT(varchar(36), a.RNC_RegID)
    WHERE a.State = ? {extra_where}
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

    election_day = model.get("election_day", DEFAULT_ELECTION_DAY)
    derive_senate = model.get("derive_senate")
    house = defaultdict(empty_stat_buckets)
    senate = defaultdict(empty_stat_buckets)
    statewide = empty_stat_buckets()
    timeline = {s: defaultdict(lambda: {b: 0 for b in BUCKETS}) for s in STATS}

    def district_timeline_factory():
        return {s: defaultdict(lambda: {b: 0 for b in BUCKETS}) for s in STATS}

    house_tl = defaultdict(district_timeline_factory)
    senate_tl = defaultdict(district_timeline_factory)

    for hd, sd, bucket, stat, event_date, n in rows:
        bucket = str(bucket or "").strip()
        stat = str(stat or "").strip()
        if bucket not in BUCKETS or stat not in STATS:
            continue
        n = int(n or 0)
        hd_id = normalize_district_id(hd)
        sd_id = normalize_district_id(sd)
        if not sd_id and derive_senate and hd_id:
            sd_id = derive_senate(hd_id)
        date_key = timeline_key(stat, event_date, today, election_day)
        if hd_id:
            house[hd_id][stat][bucket] += n
            house_tl[hd_id][stat][date_key][bucket] += n
        if sd_id:
            senate[sd_id][stat][bucket] += n
            senate_tl[sd_id][stat][date_key][bucket] += n
        statewide[stat][bucket] += n
        timeline[stat][date_key][bucket] += n

    return house, senate, statewide, timeline, house_tl, senate_tl


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
        house, senate, statewide, timeline, house_tl, senate_tl = results[abbr]

        for chamber, dmap, tlmap in (("house", house, house_tl), ("senate", senate, senate_tl)):
            if not dmap:
                continue
            out = {
                "state_fips": fips,
                "state_abbr": abbr,
                "chamber": chamber,
                "updated": updated,
                "districts": [
                    {
                        "district_id": did,
                        **dmap[did],
                        "timeline": {stat: timeline_rows(tlmap[did][stat]) for stat in STATS},
                    }
                    for did in sorted(dmap)
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


def pull_state_pooled(pool, abbr, today):
    """Worker task (#1): borrow a connection from the pool, pull one state, and
    return it plus how long it took. The pool caps concurrency at --workers."""
    conn = pool.get()
    t0 = time.monotonic()
    try:
        res = pull_state(conn, abbr, today)
    finally:
        pool.put(conn)
    return abbr, res, time.monotonic() - t0


# --- Skip-unchanged support (#4) --------------------------------------------


def state_watermark(conn, abbr):
    """A cheap fingerprint of one state's source rows: how many, and the latest
    activity date of each kind. A single-table scan (no model join), so it's far
    cheaper than the full aggregate. If this matches the last run, the state's
    source data is unchanged and we can reuse the JSON already on disk."""
    model = STATE_MODELS[abbr]
    table = model.get("abev_table", ABEV_TABLE)
    extra_where = model.get("extra_where", "")
    cur = conn.cursor()
    cur.execute(
        f"SELECT COUNT_BIG(*), "
        f"CONVERT(varchar(10), MAX(a.RequestDate), 23), "
        f"CONVERT(varchar(10), MAX(a.ReturnDate), 23), "
        f"CONVERT(varchar(10), MAX(a.EarlyVoted), 23) "
        f"FROM {table} a WHERE a.State = ? {extra_where}",
        abbr,
    )
    n, req, ret, ev = cur.fetchone()
    return {"n": int(n or 0), "req": req, "ret": ret, "ev": ev}


def load_watermarks():
    if WATERMARK_PATH.exists():
        try:
            return json.loads(WATERMARK_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_watermarks(wm):
    WATERMARK_PATH.write_text(json.dumps(wm, indent=2, sort_keys=True), encoding="utf-8")


def _load_chamber_maps(abbr, chamber):
    """Rebuild a chamber's (district-totals, district-timelines) maps from its
    existing JSON, in the exact shape pull_state() produces."""
    path = OUT_DIR / f"{abbr.lower()}_{chamber}.json"
    dmap, tlmap = {}, {}
    if not path.exists():
        return dmap, tlmap
    data = json.loads(path.read_text(encoding="utf-8"))
    for d in data.get("districts", []):
        did = d.get("district_id")
        if not did:
            continue
        dmap[did] = {stat: {b: int((d.get(stat) or {}).get(b, 0)) for b in BUCKETS} for stat in STATS}
        tl = d.get("timeline") or {}
        tlmap[did] = {}
        for stat in STATS:
            rebuilt = {}
            for row in tl.get(stat, []):
                rebuilt[row.get("date")] = {b: int(row.get(b, 0)) for b in BUCKETS}
            tlmap[did][stat] = rebuilt
    return dmap, tlmap


def load_prior_result(abbr):
    """Reconstruct a pull_state() result tuple for `abbr` from the JSON already on
    disk, so an unchanged state stays in the rebuilt national/timeline outputs
    without being re-queried. Returns None if anything needed is missing — the
    caller then just pulls it fresh, so a skip can never silently drop a state."""
    fips = ABBR_TO_FIPS[abbr]
    nat_path, tl_path = OUT_DIR / "national.json", OUT_DIR / "timeline.json"
    if not nat_path.exists() or not tl_path.exists():
        return None
    try:
        national = json.loads(nat_path.read_text(encoding="utf-8"))
        timeline_all = json.loads(tl_path.read_text(encoding="utf-8"))
        nat_entry = next(
            (s for s in national.get("states", []) if s.get("state_abbr") == abbr), None
        )
        if not nat_entry:
            return None
        statewide = {
            stat: {b: int((nat_entry.get(stat) or {}).get(b, 0)) for b in BUCKETS} for stat in STATS
        }
        tl_state = (timeline_all.get("states") or {}).get(fips, {})
        timeline = {}
        for stat in STATS:
            rebuilt = {}
            for row in tl_state.get(stat, []):
                rebuilt[row.get("date")] = {b: int(row.get(b, 0)) for b in BUCKETS}
            timeline[stat] = rebuilt
        house, house_tl = _load_chamber_maps(abbr, "house")
        senate, senate_tl = _load_chamber_maps(abbr, "senate")
        if not house and not senate:
            return None
        return house, senate, statewide, timeline, house_tl, senate_tl
    except Exception:
        return None


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
    # Stream progress line-by-line even when stdout is redirected to a file or a
    # background pipe (otherwise Python block-buffers and nothing shows until the
    # very end — the whole point of the progress readout is live updates).
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="Daily ABEV data update")
    parser.add_argument("--no-push", action="store_true", help="update files but skip git commit/push")
    parser.add_argument("--dry-run", action="store_true", help="connect and run queries, write nothing")
    parser.add_argument("--force", action="store_true",
                        help="re-pull every state, ignoring the skip-unchanged cache")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS,
                        help="max states queried in parallel (default: %(default)s)")
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

    # A dry run is meant to exercise the queries, so it never skips and never
    # writes the watermark cache.
    skip_enabled = not (args.force or args.dry_run)

    # Phase 1: one cheap fingerprint query per state (serial, single connection).
    # Unchanged states are reused from disk; the rest go on the pull list.
    prior_wm = load_watermarks() if skip_enabled else {}
    fresh_wm = {}
    results = {}
    to_pull = []
    probe = connect(cfg)
    probe.timeout = 0
    try:
        for abbr in states:
            wm = state_watermark(probe, abbr)
            fresh_wm[abbr] = wm
            if skip_enabled and prior_wm.get(abbr) == wm:
                prior = load_prior_result(abbr)
                if prior is not None:
                    results[abbr] = prior
                    print(f"[skip] {abbr} unchanged since last run — reusing on-disk data.")
                    continue
            to_pull.append(abbr)
    finally:
        probe.close()

    # Phase 2: pull the changed states in parallel, capped at --workers.
    total = len(states)
    print(f"{len(results)} unchanged, pulling {len(to_pull)}"
          f"{f' with {min(args.workers, len(to_pull))} workers' if to_pull else ''}"
          f"{': ' + ', '.join(to_pull) if to_pull else ''}")
    run_start = time.monotonic()
    if to_pull:
        n_workers = max(1, min(args.workers, len(to_pull)))
        pool = Queue()
        conns = [connect(cfg) for _ in range(n_workers)]
        for c in conns:
            c.timeout = 0
            pool.put(c)
        try:
            with ThreadPoolExecutor(max_workers=n_workers) as ex:
                futures = [ex.submit(pull_state_pooled, pool, abbr, today) for abbr in to_pull]
                done = 0
                for fut in as_completed(futures):
                    abbr, res, secs = fut.result()
                    results[abbr] = res
                    done += 1
                    left = len(to_pull) - done
                    elapsed = time.monotonic() - run_start
                    # Wall-clock average already reflects the parallelism, so this
                    # ETA holds for both serial and parallel runs.
                    eta = (elapsed / done) * left if left else 0
                    eta_txt = f", ~{fmt_dur(eta)} left for {left} more" if left else ""
                    print(f"---- [{done}/{len(to_pull)}] {abbr} finished in {fmt_dur(secs)} "
                          f"(elapsed {fmt_dur(elapsed)}{eta_txt}) ----")
        finally:
            for c in conns:
                c.close()
        print(f"Pulled {len(to_pull)} state(s) in {fmt_dur(time.monotonic() - run_start)}.")

    if args.dry_run:
        for abbr in states:
            house, senate, statewide, *_rest = results[abbr]
            print(f"[{abbr}] house districts: {len(house)}, senate districts: {len(senate)}, "
                  f"statewide requested: {sum(statewide['requested'].values()):,}")
        print("Dry run complete — no files written.")
        return

    build_outputs(results, updated)
    # On-disk JSON now matches these fingerprints, so record them for next run.
    # Merge so a partial --states run doesn't wipe other states' cached prints.
    merged_wm = load_watermarks()
    merged_wm.update(fresh_wm)
    save_watermarks(merged_wm)

    if args.no_push:
        print("Skipping git publish (--no-push).")
        return
    git_publish(updated)


if __name__ == "__main__":
    main()
