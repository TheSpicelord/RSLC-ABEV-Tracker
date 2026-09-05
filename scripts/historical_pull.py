"""One-time historical ABEV pull: past general elections -> data/abev/history/.

Unlike daily_update.py, this is a one-shot backfill (no git push loop). It pulls
the 2022 and 2024 *general election* absentee/early-vote data from the same SQL
server and buckets it with the same state models as the 2026 data, so past
cycles come out in the identical JSON shape.

    python scripts/historical_pull.py                 # 2022 + 2024, VA + WI
    python scripts/historical_pull.py --years 2024    # one year
    python scripts/historical_pull.py --states WI      # one state
    python scripts/historical_pull.py --dry-run        # connect, query, diagnostics, write nothing

Safe to run in batches. The per-chamber files are per state, but national.json,
timeline.json and history.json are per YEAR and cover every state at once, so
each run MERGES its states onto whatever is already on disk rather than
rewriting those three from scratch. (Before that fix, a --states NC run would
have deleted VA/WI/PA from the year's national + timeline files and from the
index the site reads, while leaving their per-chamber files orphaned on disk.)
The index is rebuilt by globbing the year's directory, so it always describes
the files that actually exist.

A state whose lines were redrawn between a past cycle and 2026 still gets pulled
here — the suppression is a display decision, made once in HISTORY_STALE_LINES /
LEG_REDISTRICTING_NOTES in modules/config.js. Check that before adding a state:
VA and WI are listed for 2022, and NC belongs there too (its 2022 elections ran
on the SL 2022-2 / 2022-4 interim maps, replaced Oct 2023 by the SL 2023-146 /
2023-149 maps used in 2024 and 2026).

Requires the VPN + scripts/db_config.ini (same as daily_update.py; pip install pyodbc).

Data realities this handles / surfaces:
  * 2022 tables mix in runoffs and spring/special elections -> we filter
    ElectionType = 'General Election'. 2024 appears general-only, so it's pulled
    unfiltered; the diagnostics print the ElectionType distribution so you can
    confirm (and add a filter here if a year turns out to need one).
  * Voters who have since moved away or died won't match the 2026 model. Like
    the 2026 pipeline, unmatched voters (and model "persuasion"/swing segments)
    fall into the 'toss' bucket.
  * NULL / '0' legislative or senate districts are dropped from that chamber's
    district rollup but still counted in the statewide totals — same as 2026.
  * Diagnostics flag anything funky per state/year: ElectionType breakdown,
    model match rate, and the share of NULL/0 districts (with a hard flag if a
    whole chamber's districts are empty, e.g. a state with all-0 senate lines).

Caveat worth remembering when this data is displayed: 2022/2024 were federal/
presidential cycles. VA had no state-leg election those years, and WI 2022 ran
under the pre-2023 map — so the district geography won't line up with the 2026
map for every state. The counts are still real absentee/EV turnout by the
voter's district; just don't read them as legislative-race results.
"""

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

# Reuse the single source of truth for credentials, models, and FIPS/name maps.
from daily_update import (
    ABBR_TO_FIPS,
    ABBR_TO_NAME,
    BUCKETS,
    STATE_MODELS,
    STATS,
    connect,
    load_config,
    normalize_district_id,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUT_BASE = PROJECT_ROOT / "data" / "abev" / "history"

# Per-year settings. cycle_start: requests before it are permanent-absentee
# signups (bucketed "pre<year>"); election_day: events after it are data errors
# (bucketed "unknown"). election_type_filter: applied to WHERE when not None.
YEAR_CONFIG = {
    2022: {
        "cycle_start": date(2022, 1, 1),
        "election_day": date(2022, 11, 8),
        "election_type_filter": "General Election",  # strip runoffs/specials/spring
    },
    2024: {
        "cycle_start": date(2024, 1, 1),
        "election_day": date(2024, 11, 5),
        "election_type_filter": None,  # appears general-only; diagnostics confirm
    },
}


def table_for_year(year):
    return f"dbo.General_Absentees_{year}"


def historical_query(table, model, has_election_type_filter):
    """One aggregate query per state: counts by district pair, stat, bucket, date.

    Mirrors daily_update.state_query but against a historical table and with an
    optional ElectionType filter. Aggregation is entirely server-side, so only
    summary counts leave the server.
    """
    filter_sql = " AND a.ElectionType = ?" if has_election_type_filter else ""
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
    WHERE a.State = ?{filter_sql}
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


def timeline_key(stat, event_date, cycle_start, election_day):
    """Chronological bucket for one event date, parameterized by cycle year."""
    if not isinstance(event_date, date):
        return "unknown"
    if event_date > election_day:
        return "unknown"  # after election day = data-entry error
    if event_date < cycle_start:
        # Requests predating the cycle are perm-absentee signups; a return/EV
        # date that early is a bad record.
        return f"pre{cycle_start.year}" if stat == "requested" else "unknown"
    return event_date.isoformat()


def empty_stat_buckets():
    return {s: {b: 0 for b in BUCKETS} for s in STATS}


def run_diagnostics(conn, table, abbr, model, ycfg):
    """Print the ElectionType breakdown, model match rate, and NULL-district
    share, and hard-flag anything funky (e.g. a chamber with all-0 districts)."""
    cursor = conn.cursor()
    filt = ycfg["election_type_filter"]
    print(f"  diagnostics [{abbr}]:")

    # ElectionType distribution (guard: the column may not exist for every year)
    try:
        cursor.execute(
            f"SELECT a.ElectionType, COUNT(*) AS n FROM {table} a WHERE a.State = ? "
            f"GROUP BY a.ElectionType ORDER BY n DESC",
            abbr,
        )
        rows = cursor.fetchall()
        if rows:
            shown = ", ".join(f"{et or 'NULL'}={n:,}" for et, n in rows)
            print(f"    ElectionType: {shown}")
            if filt and not any((et or "") == filt for et, _ in rows):
                print(f"    ** FLAG: filter value '{filt}' not present in ElectionType — pull will be empty.")
    except Exception as exc:  # noqa: BLE001 - column absent or not queryable
        print(f"    ElectionType: (column unavailable: {exc})")

    # Match rate + NULL/0 district share, respecting the same filter as the pull.
    params = [abbr]
    filt_sql = ""
    if filt:
        filt_sql = " AND a.ElectionType = ?"
        params.append(filt)
    cursor.execute(
        f"""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN m.{model['join_col']} IS NULL THEN 1 ELSE 0 END) AS unmatched,
            SUM(CASE WHEN a.LegislativeDistrict IS NULL OR LTRIM(RTRIM(a.LegislativeDistrict)) IN ('', '0') THEN 1 ELSE 0 END) AS null_hd,
            SUM(CASE WHEN a.SenateDistrict IS NULL OR LTRIM(RTRIM(a.SenateDistrict)) IN ('', '0') THEN 1 ELSE 0 END) AS null_sd
        FROM {table} a
        LEFT JOIN {model['model_table']} m
            ON m.{model['join_col']} = CONVERT(varchar(36), a.RNC_RegID)
        WHERE a.State = ?{filt_sql}
        """,
        params,
    )
    total, unmatched, null_hd, null_sd = cursor.fetchone()
    total = int(total or 0)
    if not total:
        print("    ** FLAG: zero rows after filter - nothing to pull for this state/year.")
        return
    unmatched = int(unmatched or 0)
    null_hd = int(null_hd or 0)
    null_sd = int(null_sd or 0)
    matched_pct = 100.0 * (total - unmatched) / total
    print(f"    rows: {total:,} | model-matched: {matched_pct:.1f}% "
          f"(unmatched->toss: {unmatched:,})")
    print(f"    NULL/0 leg district: {100.0 * null_hd / total:.1f}% ({null_hd:,}) | "
          f"NULL/0 senate district: {100.0 * null_sd / total:.1f}% ({null_sd:,})")

    if null_hd == total:
        print("    ** FLAG: every LEG district is NULL/0 - no house rollup for this state.")
    elif null_hd / total > 0.05:
        print(f"    ** FLAG: {100.0 * null_hd / total:.1f}% of leg districts are NULL/0 (>5%).")
    if null_sd == total:
        print("    ** FLAG: every SENATE district is NULL/0 - no senate rollup for this state.")
    elif null_sd / total > 0.05:
        print(f"    ** FLAG: {100.0 * null_sd / total:.1f}% of senate districts are NULL/0 (>5%).")


def pull_state_year(conn, table, abbr, model, ycfg):
    cycle_start = ycfg["cycle_start"]
    election_day = ycfg["election_day"]
    has_filter = ycfg["election_type_filter"] is not None

    print(f"  [{abbr}] aggregate query (model: {model['model_table']}) ...")
    cursor = conn.cursor()
    params = [abbr]
    if has_filter:
        params.append(ycfg["election_type_filter"])
    cursor.execute(historical_query(table, model, has_filter), params)
    rows = cursor.fetchall()
    print(f"  [{abbr}] {len(rows):,} aggregate rows returned.")

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
        date_key = timeline_key(stat, event_date, cycle_start, election_day)
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
    """Sorted timeline: pre<year> first, then dates ascending, unknown last."""
    def order(key):
        if key.startswith("pre"):
            return (0, "")
        if key == "unknown":
            return (2, "")
        return (1, key)

    return [{"date": key, **timeline_stat[key]} for key in sorted(timeline_stat, key=order)]


def load_existing(path, key):
    """Previously written national/timeline payload, or an empty container.

    This backfill is run in batches, one set of states at a time, and the
    national + timeline + index files are per-YEAR, not per-state. Rebuilding
    them from just the states in *this* run would delete every state pulled in
    an earlier batch, so each run merges onto what is already on disk."""
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")).get(key) or {}
    except Exception:  # noqa: BLE001 - a corrupt file shouldn't lose the new pull
        print(f"    ** WARNING: could not read {path.name}; it will be rebuilt "
              f"from this run's states only.")
        return {}


def build_year_outputs(year, results, updated):
    """Write one year's per-chamber + national + timeline files; return the
    index entry describing them. States pulled in earlier batches are preserved
    (see load_existing) — only the states in `results` are replaced."""
    out_dir = OUT_BASE / str(year)
    out_dir.mkdir(parents=True, exist_ok=True)
    entry = {"house": [], "senate": []}

    # Seed from disk, keyed so this run's states overwrite their own entries and
    # leave everyone else's alone.
    prior_nat = load_existing(out_dir / "national.json", "states")
    states_by_abbr = {s["state_abbr"]: s for s in prior_nat if s.get("state_abbr")}
    timeline_out = dict(load_existing(out_dir / "timeline.json", "states"))

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
                "year": year,
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
            path = out_dir / f"{abbr.lower()}_{chamber}.json"
            path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

        states_by_abbr[abbr] = {
            "state_fips": fips,
            "state_abbr": abbr,
            "state_name": ABBR_TO_NAME.get(abbr, abbr),
            **statewide,
        }
        timeline_out[fips] = {stat: timeline_rows(timeline[stat]) for stat in STATS}

    states_out = [states_by_abbr[a] for a in sorted(states_by_abbr)]

    # The index lists whatever chamber files actually exist for the year, rather
    # than only the ones this run happened to write — the directory is the truth.
    for chamber in ("house", "senate"):
        entry[chamber] = sorted(
            f"data/abev/history/{year}/{path.name}"
            for path in out_dir.glob(f"*_{chamber}.json")
        )

    (out_dir / "national.json").write_text(
        json.dumps({"year": year, "updated": updated, "states": states_out}, separators=(",", ":")),
        encoding="utf-8",
    )
    (out_dir / "timeline.json").write_text(
        json.dumps({"year": year, "updated": updated, "states": timeline_out}, separators=(",", ":")),
        encoding="utf-8",
    )
    entry["national"] = f"data/abev/history/{year}/national.json"
    entry["timeline"] = f"data/abev/history/{year}/timeline.json"
    print(f"  {year}: {len(entry['house'])} house + {len(entry['senate'])} senate files, "
          f"{len(states_out)} states ({', '.join(sorted(states_by_abbr))}).")
    return entry


def write_history_index(index_years, updated):
    """Merge this run's years onto the existing index — a run of only 2024 must
    not drop 2022 from the index the site reads."""
    OUT_BASE.mkdir(parents=True, exist_ok=True)
    path = OUT_BASE / "history.json"
    merged = {}
    if path.exists():
        try:
            merged = json.loads(path.read_text(encoding="utf-8")).get("years") or {}
        except Exception:  # noqa: BLE001
            print("  ** WARNING: history.json unreadable; rebuilding from this run.")
            merged = {}
    merged.update(index_years)
    path.write_text(
        json.dumps({"updated": updated, "years": merged}, indent=2),
        encoding="utf-8",
    )
    index_years = merged
    print(f"Wrote history index for years: {', '.join(sorted(index_years))}.")


def main():
    parser = argparse.ArgumentParser(description="One-time historical ABEV backfill (2022/2024).")
    parser.add_argument("--years", default="2022,2024",
                        help="comma-separated years to pull (default: %(default)s)")
    parser.add_argument("--states", default="VA,WI",
                        help="comma-separated state abbrs (default: %(default)s)")
    parser.add_argument("--dry-run", action="store_true",
                        help="connect, run queries + diagnostics, write nothing")
    args = parser.parse_args()

    years = []
    for token in args.years.split(","):
        token = token.strip()
        if not token:
            continue
        if not token.isdigit() or int(token) not in YEAR_CONFIG:
            sys.exit(f"No config for year {token} - add it to YEAR_CONFIG in {__file__}")
        years.append(int(token))

    states = [s.strip().upper() for s in args.states.split(",") if s.strip()]
    for abbr in states:
        if abbr not in STATE_MODELS:
            sys.exit(f"No model configured for {abbr} - add it to STATE_MODELS in daily_update.py")

    updated = date.today().isoformat()
    cfg = load_config()
    conn = connect(cfg)
    index_years = {}
    try:
        for year in years:
            ycfg = YEAR_CONFIG[year]
            table = table_for_year(year)
            print(f"\n=== {year} ({table}) ===")
            results = {}
            for abbr in states:
                model = STATE_MODELS[abbr]
                run_diagnostics(conn, table, abbr, model, ycfg)
                results[abbr] = pull_state_year(conn, table, abbr, model, ycfg)
            if not args.dry_run:
                index_years[str(year)] = build_year_outputs(year, results, updated)
            else:
                for abbr, (house, senate, statewide, *_rest) in results.items():
                    print(f"  [{abbr}] house districts: {len(house)}, senate districts: {len(senate)}, "
                          f"statewide requested: {sum(statewide['requested'].values()):,}")
    finally:
        conn.close()

    if args.dry_run:
        print("\nDry run complete - no files written.")
        return

    write_history_index(index_years, updated)


if __name__ == "__main__":
    main()
