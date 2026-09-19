"""Massachusetts: voter-file district NAME -> the district_id the app uses.

MASSACHUSETTS IS THE ONE STATE WHERE THE FEED'S DISTRICT NUMBER IS NOT THE APP'S.
The absentee feed's LegislativeDistrict agrees with voterfile_2026's
StateLegLowerDistrict (97.9% of rows), but BOTH number the 160 house districts on a
different scheme from the Census SLDLST ids every chamber file and shapefile use --
the voter file runs alphabetically, the shapefile by county. Measured on the 2026
feed, the two agree for 32 of 799,221 rows: 98.6% of Massachusetts absentee records
would be filed under the WRONG district. It fails silently, because every number is
a real district either way -- feed district 84 is "THIRD SUFFOLK", which the app
calls 125.

The district NAME is the only reliable key, which is exactly what District
Explorer's district_ids.make_resolver() concluded for the same chamber. This module
is the ABEV Tracker's copy of that decision, kept here rather than imported across
projects (the same arrangement as nh_floterials.py).

Derived from District Explorer's data/ma_house.json on 2026-09-19 and verified
against the voter file:
  * all 160 DE districts produce 160 distinct normalised names -- no collisions
  * all 159 non-blank names in voterfile_2026 map to a DE id -- none unmatched
  * the 159 ids are distinct -- no DE district is claimed twice

Only district 079 is absent: no voter-file row carries its name (those voters hold
the one blank name value). It gets no house district rather than a guessed one, the
same rule MD/ND/SD subdistricts follow.

Keys are the RAW voter-file spelling, matched exactly, so no normalisation has to be
reimplemented in SQL. A vendor respelling therefore drops that district to NULL
rather than mis-filing it -- fail-safe, and visible as a drop in the house district
count the pull reports. Regenerate after a redraw.
"""

# Raw voterfile_2026.StateLegLowerDistrict_Proper -> ma_house.json district_id.
MA_HOUSE_BY_VOTERFILE_NAME = {
    "FIRST BARNSTABLE": "001",
    "SECOND BARNSTABLE": "002",
    "THIRD BARNSTABLE": "003",
    "FOURTH BARNSTABLE": "004",
    "FIFTH BARNSTABLE": "005",
    "BARNSTABLE DUKES AND NANTUCKET": "006",
    "FIRST BERKSHIRE": "007",
    "SECOND BERKSHIRE": "008",
    "THIRD BERKSHIRE": "009",
    "FIRST BRISTOL": "010",
    "SECOND BRISTOL": "011",
    "THIRD BRISTOL": "012",
    "FOURTH BRISTOL": "013",
    "FIFTH BRISTOL": "014",
    "SIXTH BRISTOL": "015",
    "SEVENTH BRISTOL": "016",
    "EIGHTH BRISTOL": "017",
    "NINTH BRISTOL": "018",
    "TENTH BRISTOL": "019",
    "ELEVENTH BRISTOL": "020",
    "TWELFTH BRISTOL": "021",
    "THIRTEENTH BRISTOL": "022",
    "FOURTEENTH BRISTOL": "023",
    "FIRST ESSEX": "024",
    "SECOND ESSEX": "025",
    "THIRD ESSEX": "026",
    "FOURTH ESSEX": "027",
    "FIFTH ESSEX": "028",
    "SIXTH ESSEX": "029",
    "SEVENTH ESSEX": "030",
    "EIGHTH ESSEX": "031",
    "NINTH ESSEX": "032",
    "TENTH ESSEX": "033",
    "ELEVENTH ESSEX": "034",
    "TWELFTH ESSEX": "035",
    "THIRTEENTH ESSEX": "036",
    "FOURTEENTH ESSEX": "037",
    "FIFTEENTH ESSEX": "038",
    "SIXTEENTH ESSEX": "039",
    "SEVENTEENTH ESSEX": "040",
    "EIGHTEENTH ESSEX": "041",
    "FIRST FRANKLIN": "042",
    "SECOND FRANKLIN": "043",
    "FIRST HAMPDEN": "044",
    "SECOND HAMPDEN": "045",
    "THIRD HAMPDEN": "046",
    "FOURTH HAMPDEN": "047",
    "FIFTH HAMPDEN": "048",
    "SIXTH HAMPDEN": "049",
    "SEVENTH HAMPDEN": "050",
    "EIGHTH HAMPDEN": "051",
    "NINTH HAMPDEN": "052",
    "TENTH HAMPDEN": "053",
    "ELEVENTH HAMPDEN": "054",
    "TWELFTH HAMPDEN": "055",
    "FIRST HAMPSHIRE": "056",
    "SECOND HAMPSHIRE": "057",
    "THIRD HAMPSHIRE": "058",
    "FIRST MIDDLESEX": "059",
    "SECOND MIDDLESEX": "060",
    "THIRD MIDDLESEX": "061",
    "FOURTH MIDDLESEX": "062",
    "FIFTH MIDDLESEX": "063",
    "SIXTH MIDDLESEX": "064",
    "SEVENTH MIDDLESEX": "065",
    "EIGHTH MIDDLESEX": "066",
    "NINTH MIDDLESEX": "067",
    "TENTH MIDDLESEX": "068",
    "ELEVENTH MIDDLESEX": "069",
    "TWELFTH MIDDLESEX": "070",
    "THIRTEENTH MIDDLESEX": "071",
    "FOURTEENTH MIDDLESEX": "072",
    "FIFTEENTH MIDDLESEX": "073",
    "SIXTEENTH MIDDLESEX": "074",
    "SEVENTEENTH MIDDLESEX": "075",
    "EIGHTEENTH MIDDLESEX": "076",
    "NINETEENTH MIDDLESEX": "077",
    "TWENTIETH MIDDLESEX": "078",
    "TWENTY-SECOND MIDDLESEX": "080",
    "TWENTY-THIRD MIDDLESEX": "081",
    "TWENTY-FOURTH MIDDLESEX": "082",
    "TWENTY-FIFTH MIDDLESEX": "083",
    "TWENTY-SIXTH MIDDLESEX": "084",
    "TWENTY-SEVENTH MIDDLESEX": "085",
    "TWENTY-EIGHTH MIDDLESEX": "086",
    "TWENTY-NINTH MIDDLESEX": "087",
    "THIRTIETH MIDDLESEX": "088",
    "THIRTY-FIRST MIDDLESEX": "089",
    "THIRTY-SECOND MIDDLESEX": "090",
    "THIRTY-THIRD MIDDLESEX": "091",
    "THIRTY-FOURTH MIDDLESEX": "092",
    "THIRTY-FIFTH MIDDLESEX": "093",
    "THIRTY-SIXTH MIDDLESEX": "094",
    "THIRTY-SEVENTH MIDDLESEX": "095",
    "FIRST NORFOLK": "096",
    "SECOND NORFOLK": "097",
    "THIRD NORFOLK": "098",
    "FOURTH NORFOLK": "099",
    "FIFTH NORFOLK": "100",
    "SIXTH NORFOLK": "101",
    "SEVENTH NORFOLK": "102",
    "EIGHTH NORFOLK": "103",
    "NINTH NORFOLK": "104",
    "TENTH NORFOLK": "105",
    "ELEVENTH NORFOLK": "106",
    "TWELFTH NORFOLK": "107",
    "THIRTEENTH NORFOLK": "108",
    "FOURTEENTH NORFOLK": "109",
    "FIFTEENTH NORFOLK": "110",
    "FIRST PLYMOUTH": "111",
    "SECOND PLYMOUTH": "112",
    "THIRD PLYMOUTH": "113",
    "FOURTH PLYMOUTH": "114",
    "FIFTH PLYMOUTH": "115",
    "SIXTH PLYMOUTH": "116",
    "SEVENTH PLYMOUTH": "117",
    "EIGHTH PLYMOUTH": "118",
    "NINTH PLYMOUTH": "119",
    "TENTH PLYMOUTH": "120",
    "ELEVENTH PLYMOUTH": "121",
    "TWELFTH PLYMOUTH": "122",
    "FIRST SUFFOLK": "123",
    "SECOND SUFFOLK": "124",
    "THIRD SUFFOLK": "125",
    "FOURTH SUFFOLK": "126",
    "FIFTH SUFFOLK": "127",
    "SIXTH SUFFOLK": "128",
    "SEVENTH SUFFOLK": "129",
    "EIGHTH SUFFOLK": "130",
    "NINTH SUFFOLK": "131",
    "TENTH SUFFOLK": "132",
    "ELEVENTH SUFFOLK": "133",
    "TWELFTH SUFFOLK": "134",
    "THIRTEENTH SUFFOLK": "135",
    "FOURTEENTH SUFFOLK": "136",
    "FIFTEENTH SUFFOLK": "137",
    "SIXTEENTH SUFFOLK": "138",
    "SEVENTEENTH SUFFOLK": "139",
    "EIGHTEENTH SUFFOLK": "140",
    "NINETEENTH SUFFOLK": "141",
    "FIRST WORCESTER": "142",
    "SECOND WORCESTER": "143",
    "THIRD WORCESTER": "144",
    "FOURTH WORCESTER": "145",
    "FIFTH WORCESTER": "146",
    "SIXTH WORCESTER": "147",
    "SEVENTH WORCESTER": "148",
    "EIGHTH WORCESTER": "149",
    "NINTH WORCESTER": "150",
    "TENTH WORCESTER": "151",
    "ELEVENTH WORCESTER": "152",
    "TWELFTH WORCESTER": "153",
    "THIRTEENTH WORCESTER": "154",
    "FOURTEENTH WORCESTER": "155",
    "FIFTEENTH WORCESTER": "156",
    "SIXTEENTH WORCESTER": "157",
    "SEVENTEENTH WORCESTER": "158",
    "EIGHTEENTH WORCESTER": "159",
    "NINETEENTH WORCESTER": "160",}


def ma_house_case_sql(col="vf.StateLegLowerDistrict_Proper"):
    """CASE mapping the voter file's house-district name to the app's district_id.

    Guarded by MD's rule, and for the same reason: the NAME comes from the
    current voter file, but the district a ballot belongs to is the one the
    voter lived in for THAT election. The feed's own LegislativeDistrict and the
    voter file's StateLegLowerDistrict share the alphabetical numbering, so they
    can be compared directly -- if they disagree the voter moved and their
    district for that year is unknowable, so they get no house district rather
    than a guessed one. 16.0% of Massachusetts voters sit in a different house
    district than they did at the previous election, so on a backfill this is
    the difference between a real number and a plausible one.

    Anything unlisted (including the blank name) yields NULL too -- never a
    guess."""
    whens = " ".join(
        f"WHEN '{name}' THEN '{did}'"
        for name, did in MA_HOUSE_BY_VOTERFILE_NAME.items())
    crosswalk = f"CASE UPPER(LTRIM(RTRIM({col}))) {whens} ELSE NULL END"
    return ("CASE WHEN TRY_CONVERT(int, a.LegislativeDistrict) = "
            "vf.StateLegLowerDistrict THEN " + crosswalk + " ELSE NULL END")


# ---------------------------------------------------------------------------
# Senate, for the HISTORICAL feeds only.
#
# In 2026 the senate needs no crosswalk: the feed's own number is right and only
# the format is wrong, so sd_sql formats it as D%02d straight from the feed.
# The 2024 file is the problem - its SenateDistrict is a THIRD encoding, running
# 0..334 for a 40-seat chamber, and it is not even internally consistent: of its
# 40 distinct codes only 32 map to one district at >=90%, and code '33' splits
# 56/40 across districts 33 and 11. It cannot be rescued.
#
# The voter file can. Its name <-> number pairing for MA senate is an exact 1:1
# (40 names, 40 numbers, zero names spanning two numbers), and D%02d off that
# number is precisely how District Explorer reaches its own ids. Verified: all
# 40 ids exist in DE's ma_senate.json.
#
# DO NOT use the *_PreviousElection columns for this. They look like the obvious
# choice for a backfill and they are the wrong map: they hold MA's PRE-2022
# districting, not 2024. The giveaway is that they differ from current for 47.1%
# of the 2024 cohort in 100k-voter blocks, including pure renames of the same
# territory ("BERKSHIRE HAMPSHIRE FRANKLIN AND HAMPDEN" -> "BERKSHIRE HAMPDEN
# FRANKLIN AND HAMPSHIRE"). 2024 and 2026 ran on the SAME map, so CURRENT is the
# right column.
# ---------------------------------------------------------------------------
MA_SENATE_BY_VOTERFILE_NAME = {
    "BERKSHIRE HAMPDEN FRANKLIN AND HAMPSHIRE": "D01",
    "HAMPDEN AND HAMPSHIRE": "D02",
    "HAMPDEN": "D03",
    "HAMPDEN HAMPSHIRE AND WORCESTER": "D04",
    "HAMPSHIRE FRANKLIN AND WORCESTER": "D05",
    "WORCESTER AND HAMPSHIRE": "D06",
    "WORCESTER AND HAMPDEN": "D07",
    "SECOND WORCESTER": "D08",
    "FIRST WORCESTER": "D09",
    "WORCESTER AND MIDDLESEX": "D10",
    "FIRST MIDDLESEX": "D11",
    "MIDDLESEX AND WORCESTER": "D12",
    "MIDDLESEX AND NORFOLK": "D13",
    "NORFOLK WORCESTER AND MIDDLESEX": "D14",
    "THIRD MIDDLESEX": "D15",
    "FOURTH MIDDLESEX": "D16",
    "NORFOLK AND MIDDLESEX": "D17",
    "NORFOLK AND SUFFOLK": "D18",
    "FIRST ESSEX": "D19",
    "SECOND ESSEX AND MIDDLESEX": "D20",
    "FIRST ESSEX AND MIDDLESEX": "D21",
    "SECOND ESSEX": "D22",
    "FIFTH MIDDLESEX": "D23",
    "THIRD ESSEX": "D24",
    "THIRD SUFFOLK": "D25",
    "MIDDLESEX AND SUFFOLK": "D26",
    "SECOND MIDDLESEX": "D27",
    "SUFFOLK AND MIDDLESEX": "D28",
    "SECOND SUFFOLK": "D29",
    "FIRST SUFFOLK": "D30",
    "FIRST PLYMOUTH AND NORFOLK": "D31",
    "NORFOLK AND PLYMOUTH": "D32",
    "NORFOLK PLYMOUTH AND BRISTOL": "D33",
    "SECOND PLYMOUTH AND NORFOLK": "D34",
    "BRISTOL AND NORFOLK": "D35",
    "THIRD BRISTOL AND PLYMOUTH": "D36",
    "FIRST BRISTOL AND PLYMOUTH": "D37",
    "SECOND BRISTOL AND PLYMOUTH": "D38",
    "PLYMOUTH AND BARNSTABLE": "D39",
    "CAPE AND ISLANDS": "D40",
}


def ma_senate_history_case_sql(col="vf.StateLegUpperDistrict_Proper"):
    """CASE mapping the voter file's senate-district name to the app's id.

    For the historical pullers only - see the note above. Unlisted or blank
    yields NULL, i.e. no senate district, never a guess."""
    whens = " ".join(
        f"WHEN '{name}' THEN '{did}'"
        for name, did in MA_SENATE_BY_VOTERFILE_NAME.items())
    return f"CASE UPPER(LTRIM(RTRIM({col}))) {whens} ELSE NULL END"


def ma_house_history_case_sql(col="vf.StateLegLowerDistrict_Proper"):
    """House crosswalk WITHOUT the feed-agreement guard, for historical pulls.

    ma_house_case_sql() cross-checks the feed's house number against the voter
    file before trusting the name. That guard is right for 2026, where the two
    share the alphabetical numbering - but the 2024 feed's house number is its
    own third scheme, agreeing on 0.3% of rows, so the guard would reject almost
    everything. History therefore takes the name unguarded and accepts the
    residential-mobility error quantified in daily_update's MA entry."""
    whens = " ".join(
        f"WHEN '{name}' THEN '{did}'"
        for name, did in MA_HOUSE_BY_VOTERFILE_NAME.items())
    return f"CASE UPPER(LTRIM(RTRIM({col}))) {whens} ELSE NULL END"
