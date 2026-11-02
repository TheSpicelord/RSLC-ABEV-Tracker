"""Turn an early-voter spreadsheet from outside the vendor feed into the CSV that
daily_update.py reads for that state (see EXTERNAL_EV_DIR there).

    python scripts/external_ev_import.py "Party_by_Location.xlsx" KY

Keeps only the voter ID and the date voted - names, precincts and parties are
dropped - and writes scripts/external_ev/<file> (gitignored), replacing any
earlier list, so each new spreadsheet from the county is a complete snapshot.
Then run `daily_update.py --states KY`.

Defaults match Jefferson County's export: sheet "All Data", columns Voter_ID
and Timestamp. Needs openpyxl.
"""
import argparse
import csv
import sys
from datetime import date, datetime

import openpyxl

from daily_update import EXTERNAL_EV_DIR, STATE_MODELS


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("xlsx")
    parser.add_argument("state", help="state abbr with an external_ev entry in STATE_MODELS")
    parser.add_argument("--sheet", default="All Data")
    parser.add_argument("--id-col", default="Voter_ID")
    parser.add_argument("--date-col", default="Timestamp")
    args = parser.parse_args()

    abbr = args.state.upper()
    spec = (STATE_MODELS.get(abbr) or {}).get("external_ev")
    if not spec:
        sys.exit(f"STATE_MODELS['{abbr}'] has no external_ev entry.")

    ws = openpyxl.load_workbook(args.xlsx, read_only=True, data_only=True)[args.sheet]
    rows = ws.iter_rows(values_only=True)
    header = [str(h or "").strip() for h in next(rows)]
    id_i, date_i = header.index(args.id_col), header.index(args.date_col)

    out, undated = [], 0
    for row in rows:
        vid = row[id_i]
        if vid is None or not str(vid).strip():
            continue
        when = row[date_i]
        if isinstance(when, datetime):
            when = when.date()
        if not isinstance(when, date):
            undated += 1
            when = None
        out.append((str(vid).strip(), when.isoformat() if when else ""))

    EXTERNAL_EV_DIR.mkdir(parents=True, exist_ok=True)
    path = EXTERNAL_EV_DIR / spec["file"]
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["voter_id", "date"])
        writer.writerows(out)
    days = sorted({d for _, d in out if d})
    print(f"Wrote {len(out):,} voters to {path} ({days[0]} to {days[-1]}"
          f"{f', {undated:,} undated' if undated else ''}).")


if __name__ == "__main__":
    main()
