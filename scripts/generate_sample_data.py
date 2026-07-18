"""Generate SAMPLE ABEV data for every state/chamber.

Reads district IDs (and partisan lean, for realism) from the sibling
RSLC-District-Explorer project's chamber JSON files, then writes randomized
but plausible ABEV JSON files into data/abev/. All output is flagged
"sample": true so the site displays a SAMPLE DATA badge.

Replaced by scripts/daily_update.py once the SQL pipeline is live.

Usage:
    python scripts/generate_sample_data.py
"""

import json
import random
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXPLORER_DATA = PROJECT_ROOT.parent / "RSLC-District-Explorer" / "data"
OUT_DIR = PROJECT_ROOT / "data" / "abev"

TODAY = date(2026, 7, 18)  # sample "as of" date
HISTORY_DAYS = 30

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

rng = random.Random(2026)


def latest_lean(rec):
    """Dem-minus-Rep pct margin from the most recent election, else 0."""
    elections = rec.get("elections") or []
    best = None
    for e in elections:
        year = e.get("year")
        if not isinstance(year, int):
            continue
        if not isinstance(e.get("dem_pct"), (int, float)) or not isinstance(e.get("rep_pct"), (int, float)):
            continue
        if best is None or year > best[0]:
            best = (year, e["dem_pct"] - e["rep_pct"])
    return best[1] if best else rng.uniform(-20, 20)


def split_buckets(total, dem_lean):
    """Split a total into rep/dem/toss buckets given a Dem-lean in pct points."""
    toss_share = rng.uniform(0.10, 0.22)
    two_party = 1.0 - toss_share
    dem_frac = min(0.95, max(0.05, 0.5 + dem_lean / 200.0 + rng.uniform(-0.04, 0.04)))
    dem = int(round(total * two_party * dem_frac))
    rep = int(round(total * two_party * (1.0 - dem_frac)))
    toss = max(0, total - dem - rep)
    return {"rep": rep, "dem": dem, "toss": toss}


def scale_buckets(buckets, rate):
    return {k: int(round(v * min(1.0, max(0.0, rate + rng.uniform(-0.03, 0.03))))) for k, v in buckets.items()}


def district_stats(pop, dem_lean):
    pop = pop if isinstance(pop, (int, float)) and pop > 0 else 45000
    requested_total = int(pop * rng.uniform(0.04, 0.12))
    requested = split_buckets(requested_total, dem_lean + rng.uniform(2, 10))  # ABs historically lean D
    sent = scale_buckets(requested, rng.uniform(0.88, 0.99))
    returned = scale_buckets(sent, rng.uniform(0.35, 0.65))
    ev_total = int(pop * rng.uniform(0.01, 0.05))
    ev = split_buckets(ev_total, dem_lean - rng.uniform(2, 8))  # EV leans a bit more R
    return {"requested": requested, "sent": sent, "returned": returned, "ev": ev}


def sum_buckets(rows, stat):
    out = {"rep": 0, "dem": 0, "toss": 0}
    for r in rows:
        for k in out:
            out[k] += r[stat][k]
    return out


def load_index():
    index = json.loads((EXPLORER_DATA / "chamber_files.json").read_text(encoding="utf-8"))
    return index


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = load_index()
    updated = TODAY.isoformat()

    out_index = {"house": [], "senate": []}
    statewide = {}  # fips -> {stat: buckets}

    for chamber in ("house", "senate"):
        for entry in index.get(chamber, []):
            url = entry.get("url") or ""
            src = EXPLORER_DATA.parent / url
            if not src.exists():
                print(f"  !! missing {src}")
                continue
            rows = json.loads(src.read_text(encoding="utf-8"))
            if not rows:
                continue
            fips = str(rows[0].get("state_fips") or "").zfill(2)
            abbr = FIPS_TO_ABBR.get(fips)
            if not abbr:
                continue

            districts = []
            for rec in rows:
                did = str(rec.get("district_id") or "").strip()
                if not did:
                    continue
                pop = (rec.get("demographics") or {}).get("population")
                stats = district_stats(pop, latest_lean(rec))
                districts.append({"district_id": did, **stats})

            out = {
                "state_fips": fips,
                "state_abbr": abbr,
                "chamber": chamber,
                "updated": updated,
                "sample": True,
                "districts": districts,
            }
            out_path = OUT_DIR / f"{abbr.lower()}_{chamber}.json"
            out_path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
            out_index[chamber].append(f"data/abev/{out_path.name}")

            # Statewide totals come from the house file (senate for NE), padded
            # ~2% for voters that can't be matched to a district.
            use_for_statewide = chamber == "house" or (chamber == "senate" and abbr == "NE")
            if use_for_statewide and fips not in statewide:
                totals = {}
                for stat in ("requested", "sent", "returned", "ev"):
                    buckets = sum_buckets(districts, stat)
                    totals[stat] = {k: int(v * 1.02) for k, v in buckets.items()}
                statewide[fips] = totals

    # national.json
    states_out = []
    for fips in sorted(statewide):
        abbr = FIPS_TO_ABBR[fips]
        states_out.append({
            "state_fips": fips,
            "state_abbr": abbr,
            "state_name": ABBR_TO_NAME.get(abbr, abbr),
            **statewide[fips],
        })
    national = {"updated": updated, "sample": True, "states": states_out}
    (OUT_DIR / "national.json").write_text(json.dumps(national, separators=(",", ":")), encoding="utf-8")

    # history.json — ramp each state's totals up over the last HISTORY_DAYS days.
    days = []
    for i in range(HISTORY_DAYS, -1, -1):
        day = TODAY - timedelta(days=i)
        frac = (HISTORY_DAYS - i + 1) / (HISTORY_DAYS + 1)
        frac = frac ** 1.6  # slow start, accelerating ramp
        day_states = {}
        for fips, totals in statewide.items():
            day_states[fips] = {
                stat: {k: int(v * frac) for k, v in buckets.items()}
                for stat, buckets in totals.items()
            }
        days.append({"date": day.isoformat(), "states": day_states})
    history = {"sample": True, "days": days}
    (OUT_DIR / "history.json").write_text(json.dumps(history, separators=(",", ":")), encoding="utf-8")

    # index file
    index_out = {"updated": updated, "sample": True, **out_index,
                 "national": "data/abev/national.json", "history": "data/abev/history.json"}
    (OUT_DIR / "abev_files.json").write_text(json.dumps(index_out, indent=2), encoding="utf-8")

    print(f"Wrote {len(out_index['house'])} house + {len(out_index['senate'])} senate files, "
          f"{len(states_out)} states in national.json, {len(days)} days of history.")


if __name__ == "__main__":
    main()
