"""Generate modules/schedule.js: per-state AB request / AB return / early-voting
windows for the 2026 GENERAL election (Tue Nov 3, 2026).

Rules start from the NCSL tables (Table 5 request deadlines, Table 7 ballot
mail-out, Table 11 return deadlines, and the Early In-Person Voting page), but
NCSL is a national summary and is NOT authoritative where a state's own
calendar disagrees. Where they conflict, the state wins and the departure is
recorded in that state's tooltip. All "days before" / weekday / business-day
rules are computed here so the dates are exact.

Audited 2026-09-04 against state sources. Deliberate departures from NCSL:

  DE  NCSL Table 7 says 60 days (9/4). Impossible: Delaware's primary is 9/15,
      so general-election ballots cannot precede it. Delaware's calendar sets
      no start at all, only a 10/30 deadline to mail. Now 9/19 (UOCAVA), and
      the request deadline is 10/30 (NCSL's "day before at noon" is the
      in-person issuance deadline, not the mail-request one). EV is 10/22 per
      the state calendar, not NCSL's 10/24.
  CO  Statute is 29 days, or the previous Friday when that day is a state
      holiday. 10/5 is Frances Xavier Cabrini Day, so mailing opens 10/2.
  TX  Early voting is the 17th through 4th day before; the 17th day is a
      Saturday, so it opens Monday 10/19 and ends 10/30.
  HI  Voter service centers open ten BUSINESS days out (10/20), not ten
      calendar days.
  NE  The 30th day out is a Sunday, so offices open 10/5; voting ends 11/2.
  MI  Second Saturday before (10/24), which is what makes the window the
      constitutionally required 9 days.
  KS  SB 4 repealed the 3-day grace period, but the repeal is enjoined and the
      Kansas Supreme Court upheld the grace period for 2026. Subject to
      further litigation - recheck before the election.

Known judgment calls (not errors): MN early voting is shown as in-person
absentee (46 days) rather than NCSL's 18-day direct-to-tabulator window; PA
shows no early voting because its over-the-counter mail voting is counted as
absentee by the AB feed; MT in-person absentee legitimately opens (30 days)
before the mail-out (25 days).

Re-run after any rule change:  python scripts/build_schedule.py
"""
import json
from datetime import date, timedelta
from pathlib import Path

EDAY = date(2026, 11, 3)  # Tuesday
MON, TUE, WED, THU, FRI, SAT, SUN = range(7)
OUT = Path(__file__).resolve().parents[1] / "modules" / "schedule.js"

def db(n): return EDAY - timedelta(days=n)
def da(n): return EDAY + timedelta(days=n)
def wb(wd, k=1):
    d = EDAY - timedelta(days=1)
    while d.weekday() != wd:
        d -= timedelta(days=1)
    return d - timedelta(days=7 * (k - 1))
def bb(n):
    d, c = EDAY, 0
    while c < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            c += 1
    return d
def ba(n):
    d, c = EDAY, 0
    while c < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            c += 1
    return d
def md(d):
    return f"{d.month}/{d.day}" if isinstance(d, date) else d

AM, NONE = "All-mail", "None"
FIPS = {  # name -> (abbr, fips)
    "Alabama":("AL","01"),"Alaska":("AK","02"),"Arizona":("AZ","04"),"Arkansas":("AR","05"),
    "California":("CA","06"),"Colorado":("CO","08"),"Connecticut":("CT","09"),"Delaware":("DE","10"),
    "Florida":("FL","12"),"Georgia":("GA","13"),"Hawaii":("HI","15"),"Idaho":("ID","16"),
    "Illinois":("IL","17"),"Indiana":("IN","18"),"Iowa":("IA","19"),"Kansas":("KS","20"),
    "Kentucky":("KY","21"),"Louisiana":("LA","22"),"Maine":("ME","23"),"Maryland":("MD","24"),
    "Massachusetts":("MA","25"),"Michigan":("MI","26"),"Minnesota":("MN","27"),"Mississippi":("MS","28"),
    "Missouri":("MO","29"),"Montana":("MT","30"),"Nebraska":("NE","31"),"Nevada":("NV","32"),
    "New Hampshire":("NH","33"),"New Jersey":("NJ","34"),"New Mexico":("NM","35"),"New York":("NY","36"),
    "North Carolina":("NC","37"),"North Dakota":("ND","38"),"Ohio":("OH","39"),"Oklahoma":("OK","40"),
    "Oregon":("OR","41"),"Pennsylvania":("PA","42"),"Rhode Island":("RI","44"),"South Carolina":("SC","45"),
    "South Dakota":("SD","46"),"Tennessee":("TN","47"),"Texas":("TX","48"),"Utah":("UT","49"),
    "Vermont":("VT","50"),"Virginia":("VA","51"),"Washington":("WA","53"),"West Virginia":("WV","54"),
    "Wisconsin":("WI","55"),"Wyoming":("WY","56"),
}

S = {}
def add(st, req, out, due, pm, evs, eve, ev_tip="", req_tip="", out_note=""):
    S[st] = dict(req=req, out=out, due=due, pm=pm, evs=evs, eve=eve,
                 ev_tip=ev_tip, req_tip=req_tip, out_note=out_note)

#   state             request     ballots-out  return-due  postmark/return tip                         ev-start  ev-end    ev tooltip
add("Alabama",        db(7),  db(45), EDAY, "", NONE, NONE, "No in-person early voting; excuse-required absentee only")
add("Alaska",         db(10), db(25), da(10), "Postmarked by 11/3, received within 10 days (by 11/13).", db(15), EDAY, "")
add("Arizona",        db(11), db(27), EDAY, "", db(27), wb(FRI), "", "", "Ballots mailed 24-27 days out (earliest shown).")
add("Arkansas",       db(7),  db(46), EDAY, "", db(15), wb(MON), "")
add("California",     AM,     db(29), da(7), "Postmarked by 11/3, received within 7 days (by 11/10).", db(29), EDAY, "", "Ballot mailed automatically to all active voters — no application needed.")
add("Colorado",       AM,     db(32), EDAY, "", db(15), EDAY, "", "Ballot mailed automatically to all active voters — no application needed.",
    "Mailing opens 10/2: statute says no sooner than 29 days out, or the previous Friday when that day is a state holiday — 10/5 is Frances Xavier Cabrini Day. Clerks must finish mailing by 10/9 (25 days).")
add("Connecticut",    db(1),  db(31), EDAY, "", db(15), db(2), "", "New no-excuse mail voting begins 2026.")
add("Delaware",       db(4),  db(45), EDAY, "", db(12), wb(SUN), "",
    "Deadline to request a ballot be MAILED; in-person issuance continues to noon 11/2.",
    "Mail-out date approximate. Delaware sets no statutory start — its calendar fixes only the 10/30 deadline to mail — and the state primary is 9/15, so general-election ballots cannot precede it; 9/19 is the federal 45-day UOCAVA transmission date. NCSL Table 7 lists Delaware at 60 days (9/4), which contradicts the state's own calendar.")
add("Florida",        db(12), db(40), EDAY, "", db(10), db(3), "Counties may extend early voting to 10/19-11/1 (15th through 2nd day before).", "", "Ballots mailed 33-40 days out (earliest shown).")
add("Georgia",        db(11), db(29), EDAY, "", wb(MON,4), wb(FRI), "", "", "Ballots mailed 25-29 days out (earliest shown).")
add("Hawaii",         AM,     db(18), EDAY, "", bb(10), EDAY, "Voter service centers open 10 business days out (10/20); closed Sundays.", "Ballot mailed automatically to all active voters — no application needed.", "Mail-out date approximate; ballots reach voters ~18 days before.")
add("Idaho",          db(11), db(45), EDAY, "", wb(MON,4), wb(FRI), "")
add("Illinois",       db(5),  db(40), da(14), "Postmarked by 11/3, received within 14 days (by 11/17).", db(40), db(1), "")
add("Indiana",        db(12), db(45), EDAY, "", db(28), db(1), "Early voting ends at noon the day before (11/2).")
add("Iowa",           db(15), db(20), EDAY, "", db(20), db(1), "")
add("Kansas",         wb(TUE),db(20), da(3), "Postmarked by 11/3, received within 3 days (by 11/6). SB 4 repealed this grace period, but the repeal is enjoined and the Kansas Supreme Court upheld the grace period for 2026 — subject to further litigation.", db(7), db(1),
    "Guaranteed only in the final week; counties may open as early as 10/14 (up to 20 days before).")
add("Kentucky",       db(14), db(50), EDAY, "", wb(THU), wb(SAT), "")
add("Louisiana",      db(4),  db(45), db(1), "Ballot must be received by 4:30pm the day before the election (11/2).", db(14), db(7), "")
add("Maine",          bb(3),  db(30), EDAY, "", db(30), bb(3), "Municipal option; hours vary and ballots may be available up to 45 days out (as early as 9/19).")
add("Maryland",       wb(TUE),db(43), da(10), "Postmarked by 11/3, received within 10 days (by 11/13).", wb(THU,2), wb(THU), "")
add("Massachusetts",  bb(5),  db(30), da(3), "Postmarked by 11/3, received by the 3rd day after (11/6).", db(17), bb(2), "")
add("Michigan",       db(4),  db(45), EDAY, "", wb(SAT,2), wb(SUN), "Constitutional 9-day minimum, second Saturday before through the Sunday before; counties may extend to 29 days total (as early as 10/5).")
add("Minnesota",      db(1),  db(46), EDAY, "", db(46), db(1), "Early voting is in-person absentee.")
add("Mississippi",    wb(SAT),db(40), ba(5), "Postmarked by 11/3, received within 5 business days (by 11/10).", NONE, NONE, "No in-person early voting; excuse-required absentee only.", "In-person absentee request accepted until noon Sat 10/31.")
add("Missouri",       wb(WED,2), db(42), EDAY, "", wb(TUE,2), db(1), "")
add("Montana",        db(1),  db(25), EDAY, "", db(30), db(1),
    "In-person absentee opens when ballots are available (by 30 days out, 10/4) — earlier than the 25-day mail-out, so this window legitimately starts before ballots are mailed.")
add("Nebraska",       wb(FRI,2), db(35), EDAY, "", db(29), db(1), "Opens 30 days out, but that day (10/4) is a Sunday, so offices open Monday 10/5; ends the day before the election. County option; satellite sites vary.")
add("Nevada",         AM,     db(20), da(4), "Postmarked by 11/3, received within 4 days (by 11/7).", wb(SAT,3), wb(FRI), "", "Ballot mailed automatically to all active voters — no application needed.")
add("New Hampshire",  db(1),  db(30), EDAY, "", NONE, NONE, "No in-person early voting; excuse-required absentee only.")
add("New Jersey",     db(7),  db(45), da(6), "Postmarked by 11/3, received within 6 days (by 11/9).", db(10), db(2), "")
add("New Mexico",     db(14), db(28), EDAY, "", db(28), wb(SAT), "")
add("New York",       db(10), db(46), da(7), "Postmarked by 11/3, received within 7 days (by 11/10).", db(10), db(2), "")
add("North Carolina", wb(TUE,2), db(60), EDAY, "", wb(THU,3), wb(SAT), "Early voting ends at 3pm the last Saturday (10/31).")
add("North Dakota",   db(1),  db(40), EDAY, "", db(15), db(1), "County option — not offered in every county; where offered, within the 15 days before (10/19-11/2).", "No firm mail deadline; request early enough to be mailed a ballot.")
add("Ohio",           db(7),  db(29), EDAY, "", db(29), db(2), "")
add("Oklahoma",       wb(MON,3), db(45), EDAY, "", wb(WED), wb(SAT), "Early voting ends at 2pm Saturday (10/31).")
add("Oregon",         AM,     db(20), da(7), "Postmarked by 11/3, received within 7 days (by 11/10).", wb(FRI), EDAY, "In-person options are limited (drop-off / county office).", "Ballot mailed automatically to all active voters — no application needed.")
add("Pennsylvania",   wb(TUE), wb(TUE,2), EDAY, "", NONE, NONE, "No traditional in-person early voting; over-the-counter mail voting is counted as absentee.")
add("Rhode Island",   db(21), db(21), EDAY, "", db(20), db(1), "", "", "Mail-out date approximate (~3 weeks before).")
add("South Carolina", db(11), db(30), EDAY, "", db(14), db(1), "")
add("South Dakota",   db(1),  db(46), EDAY, "", db(46), db(1), "")
add("Tennessee",      db(10), db(30), EDAY, "", db(20), db(5), "", "", "Mail-out date approximate (~30 days before).")
add("Texas",          db(11), db(45), da(1), "Postmarked by 11/3, received by the day after (11/4).", db(15), db(4),
    "Early voting runs the 17th through 4th day before; the 17th day (10/17) is a Saturday, so it opens Monday 10/19.")
add("Utah",           AM,     db(21), EDAY, "", db(14), wb(FRI), "", "Ballot mailed automatically to all active voters — no application needed.")
add("Vermont",        AM,     db(43), EDAY, "", db(43), db(1), "", "Ballot mailed automatically to all active voters (general election).")
add("Virginia",       db(11), db(45), da(3), "Postmarked by 11/3, received by noon the 3rd day after (11/6).", db(45), wb(SAT), "")
add("Washington",     AM,     db(18), da(20), "Postmarked by 11/3; counted until county certification (~11/23).", db(18), EDAY, "", "Ballot mailed automatically to all active voters — no application needed.")
add("West Virginia",  db(6),  db(46), da(6), "Postmarked by 11/3; counted if received before the canvass (~11/9).", db(13), db(3), "")
add("Wisconsin",      db(5),  db(47), EDAY, "", db(14), wb(SUN), "Municipal; 10/20 is the earliest allowed — clerks may set a shorter window (later start).")
add("Wyoming",        db(1),  db(28), EDAY, "", db(28), db(1), "")

def iso(d):
    return d.isoformat() if isinstance(d, date) else None

def build():
    out = {}
    for st, r in S.items():
        abbr, fips = FIPS[st]
        all_mail = r["req"] == AM
        req = AM if all_mail else md(r["req"])
        # Dash (not arrow) between the two dates, matching the EV column.
        ret = f"{md(r['out'])} – {md(r['due'])}"
        ret_tip = "; ".join(x for x in (r["pm"], r["out_note"]) if x)
        no_ev = r["evs"] == NONE
        ev = "None" if no_ev else f"{md(r['evs'])} – {md(r['eve'])}"
        out[fips] = {
            "abbr": abbr,
            "request": req, "requestTip": r["req_tip"],
            "reqEnd": None if all_mail else iso(r["req"]),   # window is [now .. deadline]
            "ret": ret, "retTip": ret_tip,
            "retStart": iso(r["out"]), "retEnd": iso(r["due"]),
            "ev": ev, "evTip": r["ev_tip"],
            "evStart": None if no_ev else iso(r["evs"]),
            "evEnd": None if no_ev else iso(r["eve"]),
        }
    return out

def emit(data):
    lines = [
        "// AUTO-GENERATED by scripts/build_schedule.py — do not hand-edit lightly.",
        "// Per-state AB request / AB return / early-voting windows for the",
        "// 2026 GENERAL election (Nov 3, 2026). Sources: NCSL Tables 5/7/11 +",
        "// Early In-Person Voting, overridden by each state's own calendar where the",
        "// two disagree (see the departures listed in build_schedule.py). Audited",
        "// 2026-09-04. Dates are display strings (M/D).",
        "// Re-run: python scripts/build_schedule.py",
        "",
        'export const ABEV_SCHEDULE_LABEL = "Absentee & Early Voting windows — 2026 General (Nov 3)";',
        "",
        "export const ABEV_SCHEDULE = {",
    ]
    for fips in sorted(data):
        lines.append(f"  {json.dumps(fips)}: {json.dumps(data[fips], ensure_ascii=False)},")
    lines.append("};")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(data)} states).")

if __name__ == "__main__":
    emit(build())
