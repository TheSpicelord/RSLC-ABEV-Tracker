"""2024 presidential results by county -> data/county_pres_2024.json.

    python scripts/build_county_pres.py

One-off reference data for comparing ABEV return rates against the 2024
presidential margin, county by county. The ABEV pull rolls ballots up to county
FIPS (daily_update.county_id), and this file is keyed the same way.

Source: tonmcg/US_County_Level_Election_Results_08-24, the standard public
county-level compilation. Verified on build (2026-10-08) against certified
totals: Trump 77,294,799 / Harris 75,006,739 nationally, and AZ R+5.53,
MI R+1.41, PA R+1.71, WI R+0.86, GA R+2.19. The SQL server has no usable
alternative - DDHQ_2024G_* exist but are empty.

Two states do not key by ordinary county FIPS, and both are kept as published:
  * CONNECTICUT reports by its nine planning regions (09110-09190), which
    replaced its eight counties as Census county-equivalents in 2022. The ABEV
    feed's Juriscode still carries the OLD county prefix, so this script also
    writes scripts/ct_town_regions.json (town code -> region, from the Census
    gazetteer) and daily_update.county_id maps CT ballots through it.
  * ALASKA has no counties; results come by state house district (02001 is
    HD 1). Compare Alaska against its house rollup instead.

No voter-level data: these are published county totals.
"""

import csv
import io
import json
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

SOURCE_URL = ("https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/"
              "master/2024_US_County_Level_Presidential_Results.csv")
OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "county_pres_2024.json"
GAZETTEER_URL = ("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/"
                 "2024_Gaz_cousubs_national.zip")
CT_PATH = Path(__file__).resolve().parent / "ct_town_regions.json"


def build_ct_crosswalk():
    """CT town (county-subdivision) code -> planning region, from the gazetteer.
    A CT GEOID is 09 + region (3) + town (5); the town part never changed."""
    with urllib.request.urlopen(GAZETTEER_URL, timeout=120) as resp:
        z = zipfile.ZipFile(io.BytesIO(resp.read()))
    lines = z.read(z.namelist()[0]).decode("latin-1").splitlines()
    towns = {}
    for line in lines[1:]:
        if line.startswith("CT"):
            f = line.split("\t")
            towns[f[1][5:]] = {"region": f[1][:5], "name": f[3]}
    CT_PATH.write_text(json.dumps({
        "source": "Census 2024 Gazetteer, county subdivisions (2024_Gaz_cousubs_national)",
        "note": "CT town (county-subdivision) code -> planning region FIPS. Town codes did "
                "not change when the nine planning regions replaced the eight counties in 2022.",
        "towns": dict(sorted(towns.items())),
    }, indent=1), encoding="utf-8")
    print(f"Wrote {len(towns)} CT towns to {CT_PATH.name}.")


def main():
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as resp:
        rows = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))

    counties = {}
    for r in rows:
        fips = r["county_fips"].strip().zfill(5)
        gop, dem, total = int(r["votes_gop"]), int(r["votes_dem"]), int(r["total_votes"])
        counties[fips] = {
            "name": r["county_name"].strip(),
            "state": r["state_name"].strip(),
            "gop": gop,
            "dem": dem,
            "total": total,
            # Trump minus Harris as points of ALL votes cast, R-positive.
            "margin": round(100.0 * (gop - dem) / total, 2) if total else None,
        }

    gop = sum(c["gop"] for c in counties.values())
    dem = sum(c["dem"] for c in counties.values())
    OUT_PATH.write_text(json.dumps({
        "source": SOURCE_URL,
        "built": date.today().isoformat(),
        "margin_note": "Trump minus Harris, points of total votes; positive = Trump",
        "counties": counties,
    }, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(counties):,} counties to {OUT_PATH.name} "
          f"(Trump {gop:,} / Harris {dem:,}).")
    build_ct_crosswalk()


if __name__ == "__main__":
    main()
