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


def illinois_senate_from_house(hd_id):
    """Illinois nests exactly two house districts per senate district, so
    SD = ceil(HD / 2). This is constitutional, not conventional: Art. IV s.3
    requires every senate district be divided into two representative
    districts, and the feed bears it out - nesting holds for 100.0% of IL rows
    in both 2024 and 2026.

    It holds for only 93.6% of 2022 rows. The 2022 SenateDistrict column is
    simply wrong for ~109k voters, concentrated in SD 25 (18,757 rows) and
    SD 42 (14,090). That is a vendor data defect, NOT a redraw: Illinois used
    one legislative map for the whole decade, and the 2022 LegislativeDistrict
    column agrees with 2024 everywhere (no district retains under 91%). So the
    house column is trustworthy and the senate column is recoverable from it,
    which is what `senate_always_derived` does on the historical path.
    """
    if not hd_id.isdigit():
        return ""
    n = int(hd_id)
    if not 1 <= n <= 118:
        return ""
    return str((n + 1) // 2).zfill(3)


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
    # Wisconsin and Michigan run the Aug 2026 refresh format, which carries an explicit
    # Framework column ("Rep" / "Pers" / "Dem") beside the universe ladder. Bucket on
    # Framework, not a universe range: the two tables do NOT number their universes the
    # same way (WI puts "Available Dems" at 7 as Pers, MI at 6 as Dem), so a range that
    # is right for one silently mis-buckets the other. This is also what District
    # Explorer's model does for these two, so the projects agree district for district.
    "WI": {
        "model_table": "dbo.RSLC_WI_Exchange_20260819",
        "join_col": "dt_regid",
        "election_day": date(2026, 4, 7),  # spring Supreme Court (test data)
        "bucket_sql": (
            "CASE WHEN m.Framework = 'Rep' THEN 'rep' "
            "WHEN m.Framework = 'Dem' THEN 'dem' "
            "ELSE 'toss' END"  # 'Pers' and unmatched -> toss
        ),
    },
    "MI": {
        "model_table": "dbo.RSLC_MI_R2_Exchange_20260805",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.Framework = 'Rep' THEN 'rep' "
            "WHEN m.Framework = 'Dem' THEN 'dem' "
            "ELSE 'toss' END"  # 'Pers' and unmatched -> toss
        ),
    },
    # Alaska has its own statewide DSP model (Sullivan vs Peltola, the 2026 U.S.
    # Senate race): framework = 'Sullivan' -> rep, 'Peltola' -> dem, everything
    # else ('Persuasion' + unmatched) -> toss, exactly like every other state
    # model. It served the Aug 18 primary and carries straight over to the Nov 3
    # general, which is what this entry now pulls (General feed, default election
    # day — the temporary primary bolt-on was retired after that election).
    # derive_senate still fills in the senate district the AK feed omits.
    "AK": {
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
    # North Carolina runs on the national fallback, like RI, because the one NC
    # file on the server is not a partisan classification and cannot be used as
    # one. dbo.NC_Legislative_GOP_UAF_Scores_Audiences is a *GOP targeting* file
    # (the name is literal): its five audiences are clean and mutually exclusive,
    # but they split 3.2M "GOP" to 1.3M "DEM" in an even state, it covers only
    # 66.8% of the NC absentee feed against 90-99% for every other state model,
    # and the misses are partisan - urban Dem districts match ~44-50%, rural GOP
    # ones ~80%. Bucketing on it puts the 2024 NC absentee electorate at R+29.7.
    # The national model matches 97.5% of the same feed, uniformly (97-99% in
    # every senate district), and lands it at R+3.9 against an actual Trump +3.2.
    # If a real RSLC NC exchange file ever arrives, swap it in here and index it.
    "NC": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    # Illinois runs on the national fallback, like RI, NC and IA - there is no
    # RSLC IL exchange file on the server. The national model matches 90.1% of
    # the 2022 IL absentee feed, in line with the 88-98% it gets everywhere else,
    # and puts that electorate at R-42.1, which is unremarkable for an Illinois
    # absentee universe. Wired 2026-09-05 so the 2022/2024 backfill can run;
    # NOT added to ACTIVE_STATES, so this publishes nothing for 2026 until
    # someone decides to activate it (the feed already carries 444,380 IL rows).
    "IL": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
        # Always recompute the senate district from the house one - see
        # illinois_senate_from_house() for why the 2022 column cannot be trusted.
        "derive_senate": illinois_senate_from_house,
        "senate_always_derived": True,
    },
    # WV / MD / DE run on the national fallback - no RSLC exchange file exists
    # for any of them. Coverage against the historical feeds is in line with
    # every other fallback state: WV 91.0% / 96.3%, MD 91.7% / 95.9%,
    # DE 90.2% / 95.1% for 2022 / 2024. Added 2026-09-05 for the backfill; none
    # is in ACTIVE_STATES, and none has 2026 feed rows yet.
    "WV": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    # Maryland: see MD_HOUSE_NOT_A_HOUSE_UNIT in historical_pull.py. The feed's
    # LegislativeDistrict is the *legislative* district (1-47) and is literally
    # the same column as SenateDistrict, so it cannot express Maryland's 71
    # house units - 29 whole districts electing 3 delegates at large, plus 42
    # lettered subdistricts (01A, 27C ...). The senate rollup is exact.
    "MD": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
        # Rebuild the house district from dbo.voterfile_2026, which is the only
        # place the subdistrict letter exists. Two rules make this safe:
        #  1. The DISTRICT still comes from the absentee feed, which is correct
        #     for the year being pulled. Only the LETTER comes from the voter
        #     file, and only when the voter file agrees on the district - if it
        #     disagrees the voter moved after that election and their historical
        #     subdistrict is unknowable, so they get no house district at all.
        #  2. An undivided district keeps its plain 3-digit id.
        # Produces DE-style ids: "01A", "27C", "003". Attribution in the 18
        # subdivided districts is 84.8% (2022) / 92.1% (2024); the other 29 are
        # complete. StateLegLowerDistrict_Proper is empty for MD, and the
        # *_PreviousElection columns add ~0.2pp, so neither is used.
        "hd_sql": (
            "CASE WHEN LTRIM(RTRIM(ISNULL(vf.StateLegLowerSubDistrict, ''))) <> '' "
            "AND vf.StateLegLowerDistrict = TRY_CONVERT(int, a.LegislativeDistrict) "
            "THEN RIGHT('0' + CAST(vf.StateLegLowerDistrict AS varchar(2)), 2) "
            "+ UPPER(LTRIM(RTRIM(vf.StateLegLowerSubDistrict))) "
            "WHEN TRY_CONVERT(int, a.LegislativeDistrict) IN "
            "(1,2,7,9,11,12,27,29,30,33,34,35,37,38,42,43,44,47) THEN NULL "
            "ELSE a.LegislativeDistrict END"
        ),
        "extra_join": (
            "LEFT JOIN dbo.voterfile_2026 vf "
            "ON vf.RNC_Regid = a.RNC_RegID AND vf.state = 'md'"
        ),
    },
    "DE": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    # ND / SD / NE on the national fallback - no exchange file exists for any of
    # them. Added 2026-09-08 for the 2022/2024 backfill; none is in ACTIVE_STATES
    # and none has 2026 feed rows yet.
    #
    # ND and SD both need MD's subdistrict treatment. Their absentee feeds carry
    # the plain district number, and LegislativeDistrict is byte-identical to
    # SenateDistrict, so the House subdistricts have nowhere to live: ND splits
    # district 4 into 4A/4B (Fort Berthold), SD splits 26 and 28 into A/B halves,
    # both to protect tribal voting strength. Without hd_sql those voters land on
    # "004"/"026"/"028", which exist in no chamber file, and 2 ND + 4 SD districts
    # come out empty. voterfile_2026.StateLegLowerSubDistrict supplies the letter.
    # Same two safety rules as MD: the DISTRICT still comes from the absentee feed
    # (correct for the year pulled) and only the LETTER comes from the voter file,
    # and only where the two agree on the district - a voter who moved since that
    # election has an unknowable historical subdistrict and gets no house district
    # rather than a guessed one.
    "ND": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
        "hd_sql": (
            "CASE WHEN LTRIM(RTRIM(ISNULL(vf.StateLegLowerSubDistrict, ''))) <> '' "
            "AND vf.StateLegLowerDistrict = TRY_CONVERT(int, a.LegislativeDistrict) "
            "THEN RIGHT('0' + CAST(vf.StateLegLowerDistrict AS varchar(2)), 2) "
            "+ UPPER(LTRIM(RTRIM(vf.StateLegLowerSubDistrict))) "
            "WHEN TRY_CONVERT(int, a.LegislativeDistrict) IN (4) THEN NULL "
            "ELSE a.LegislativeDistrict END"
        ),
        "extra_join": (
            "LEFT JOIN dbo.voterfile_2026 vf "
            "ON vf.RNC_Regid = a.RNC_RegID AND vf.state = 'nd'"
        ),
    },
    "SD": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
        "hd_sql": (
            "CASE WHEN LTRIM(RTRIM(ISNULL(vf.StateLegLowerSubDistrict, ''))) <> '' "
            "AND vf.StateLegLowerDistrict = TRY_CONVERT(int, a.LegislativeDistrict) "
            "THEN RIGHT('0' + CAST(vf.StateLegLowerDistrict AS varchar(2)), 2) "
            "+ UPPER(LTRIM(RTRIM(vf.StateLegLowerSubDistrict))) "
            "WHEN TRY_CONVERT(int, a.LegislativeDistrict) IN (26,28) THEN NULL "
            "ELSE a.LegislativeDistrict END"
        ),
        "extra_join": (
            "LEFT JOIN dbo.voterfile_2026 vf "
            "ON vf.RNC_Regid = a.RNC_RegID AND vf.state = 'sd'"
        ),
    },
    # Nebraska is unicameral: its 49 seats are the SENATE chamber here, and the
    # feed's LegislativeDistrict is '0' on every row. That produces no house
    # rollup and no ne_house.json, which is correct - District Explorer has no
    # ne_house.json either, and the site shows a "switch to Upper Chamber"
    # message. historical_pull's "every LEG district is NULL/0" flag is EXPECTED
    # for NE and is not a defect.
    "NE": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    # IN / KY / TN on the national fallback - no exchange file for any of them.
    # Added 2026-09-08 for the backfill; none is in ACTIVE_STATES and none has
    # 2026 feed rows. District ids are plain and match District Explorer exactly,
    # so none needs MD/ND/SD-style hd_sql. Three feed quirks to know about:
    #
    #  * KY is ABSENT FROM THE 2024 FEED ENTIRELY - General_Absentees_2024 carries
    #    49 states and Kentucky is not one of them. KY backfills 2022 only, and
    #    its 2024 columns are missing rather than zero. Nothing to fix here; it is
    #    a vendor gap. Re-pull KY for 2024 if it ever appears.
    #  * KY 2022 carries ONE date for mail ballots: RequestDate = ReturnDate on all
    #    75,118 of them, with zero requests lacking a return. So KY's Requested and
    #    Returned views are necessarily identical - that is the source data, not a
    #    double-count. The other 267,916 rows are early votes.
    #  * TN IS EARLY-VOTE ONLY in both years: RequestDate and ReturnDate are NULL on
    #    every one of its 2.2M (2024) / 882k (2022) rows. Tennessee has no no-excuse
    #    absentee, and the feed carries only early in-person, so TN's Requested and
    #    Returned views are zero BY DESIGN - the mirror image of RI, which is
    #    request-only. Do not read a TN zero as missing data.
    "IN": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    "KY": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    "TN": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    # MT / ID / WY on the national fallback - no exchange file for any of them.
    # Added 2026-09-08 for the backfill; none is in ACTIVE_STATES and none has
    # 2026 feed rows. All three have plain numeric district ids matching District
    # Explorer exactly (MT 100/50, ID 35/35, WY 62/31), so none needs hd_sql.
    # Feed quirks, all verified rather than assumed:
    #
    #  * MT HAS NO EARLY-VOTE ROWS in either year. Montana does allow in-person
    #    absentee at the county office from 30 days out, so unlike TN/OR this is a
    #    FEED gap rather than a legal one - the votes exist, the column doesn't.
    #    MT's EV view is therefore zero, and its AB Requested/Returned are complete.
    #  * ID has 51,459 early votes in 2022 and ZERO in 2024 - the 2024 column was
    #    not delivered. Idaho did hold early voting in 2024, so do not read the
    #    2024 zero as "Idaho stopped early voting".
    #  * ID drops 4.4% (2024) / 2.2% (2022) of rows to a NULL senate district while
    #    the house district is fine, even though Idaho's senate and house share one
    #    district number. Those rows are missing from the senate rollup only.
    #  * WY 2022 IS EFFECTIVELY REQUEST-ONLY: 57,634 requests against 62 returns and
    #    zero early votes. 2024 is healthy (37,563 / 34,499 / 81,211), so this is a
    #    2022-specific vendor gap, not how Wyoming votes.
    "MT": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    "ID": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    "WY": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    # CA / WA on the national fallback - no exchange file for either. Added
    # 2026-09-08 for the backfill; neither is in ACTIVE_STATES and neither has
    # 2026 feed rows. Plain numeric district ids matching District Explorer
    # exactly (CA 80/40, WA 49/49), so no hd_sql needed.
    #
    #  * CA is by far the largest backfill: 22.5M rows in 2024 and 21.9M in 2022,
    #    against the 227M-row national model. Budget real time for it.
    #  * WA's senate and house share one district number, the way Idaho's do -
    #    49 districts each electing one senator and two representatives.
    #  * WA IS ESSENTIALLY ALL VOTE-BY-MAIL: 13,991 early votes against 5.0M rows
    #    in 2024 (0.3%), 10,558 against 3.1M in 2022. That is real but negligible,
    #    not a feed gap - Washington mails every voter a ballot.
    "CA": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    "WA": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    # New Hampshire: the SUN audience file, bucketed on the GOVERNOR ballot
    # (Ayotte vs the generic Democrat). Chosen 2026-09-09 over the Senate ballot,
    # which is the other half of the same table - District Explorer carries BOTH
    # as side-by-side columns (model_sungov_all / model_sunsen_all), so the two
    # projects agree on the governor number and DE additionally shows the senate
    # one. To switch the tracker to the Senate race, swap the two column names
    # below for sen_ballot_named_sununu_audience / sen_ballot_named_pappas_
    # audience; the index already INCLUDEs all four, so no index change is needed.
    #
    # The pair is mutually exclusive but NOT exhaustive: 9.7% of voters are in
    # neither governor audience and correctly fall to 'toss', so New Hampshire has
    # a real swing bucket even though the model has no explicit persuasion column.
    #
    # Note the join column is `rnc_reg_id`, not dt_regid, and the table is in the
    # VS schema. The plain string join used here works (85.7% of the 2024 feed,
    # 81.4% of 2022) - the ids are uppercase dashed GUIDs, the same shape
    # CONVERT(varchar(36), RNC_RegID) produces.
    "NH": {
        "model_table": "VS.NH_Audiences_20260812",
        "join_col": "rnc_reg_id",
        "bucket_sql": (
            "CASE WHEN m.gov_ballot_named_ayotte_audience = 1 THEN 'rep' "
            "WHEN m.gov_ballot_named_dem_audience = 1 THEN 'dem' "
            "ELSE 'toss' END"  # in neither audience -> toss
        ),
    },
    # CT / NY on the national fallback - no exchange file for either. Coverage
    # CT 85.3% / 90.2%, NY 87.6% / 88.3% for 2022 / 2024. Neither is in
    # ACTIVE_STATES and neither has 2026 feed rows. CT 2022 has no early-vote
    # rows at all, correctly: Connecticut had no in-person early voting until
    # 2024, so its 2022 EV view is zero by law, not by omission.
    "CT": {
        "model_table": NATIONAL_MODEL_TABLE,
        "join_col": "dt_regid",
        "bucket_sql": NATIONAL_BUCKET_SQL,
    },
    "NY": {
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
    # ---- Ported from District Explorer's build_model_margins.py MODELS ----------
    # Same tables, same bases, so a district's lean matches between the two projects.
    # Watch the three non-standard ladders: GA runs to 9 universes (Dem base 8-9) and
    # NJ/[MI] to 9 and 8 (NJ Dem base 7-9), so the usual 1-2 / 6-7 split is wrong for
    # them. Anything outside the listed bases (persuasion/swing) and every unmatched
    # voter falls to 'toss', as always.
    "NV": {
        "model_table": "dbo.NV_GOV_IE_R1_Exchange_20260105",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.universenumber IN (1, 2) THEN 'rep' "
            "WHEN m.universenumber IN (6, 7) THEN 'dem' "
            "ELSE 'toss' END"
        ),
    },
    "AZ": {
        "model_table": "dbo.RGA_AZ_R2_Exchange_20260121",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.universenumber IN (1, 2) THEN 'rep' "
            "WHEN m.universenumber IN (6, 7) THEN 'dem' "
            "ELSE 'toss' END"
        ),
    },
    "GA": {
        # 9 universes, not 7 — the Dem base is 8-9.
        "model_table": "dbo.RSLC_GA_Exchange_20260721",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.universenumber IN (1, 2) THEN 'rep' "
            "WHEN m.universenumber IN (8, 9) THEN 'dem' "
            "ELSE 'toss' END"
        ),
    },
    "NJ": {
        # 9 universes with three-deep bases: 1-3 rep, 7-9 dem.
        "model_table": "dbo.RSLC_NJ_Transfer_20250712",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.universenumber IN (1, 2, 3) THEN 'rep' "
            "WHEN m.universenumber IN (7, 8, 9) THEN 'dem' "
            "ELSE 'toss' END"
        ),
    },
    "KS": {
        # RAGA Kansas model, 9 universes (1 Kobach Base .. 9 Mann Base). The bases are
        # asymmetric as specified by the model's owner: 1-2 GOP against 7-9 Dem, so
        # universe 7 "Available Democrats" counts as Dem while its mirror, universe 3
        # "Trump 2024 Overperform", counts as neither. Worth ~1.6 points of margin toward
        # the Dem side versus a symmetric split -- deliberate, not a typo.
        # Shared with District Explorer's MODELS["KS"], which replaced a dropped-in
        # workbook with this table on 2026-09-08.
        "model_table": "dbo.RAGA_KS_Exchange_20260708",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.universenumber IN (1, 2) THEN 'rep' "
            "WHEN m.universenumber IN (7, 8, 9) THEN 'dem' "
            "ELSE 'toss' END"
        ),
    },
    "TX": {
        # Audience flags rather than universes, and they are varchar '1'/'0' — an
        # unquoted = 1 comparison would fail to match anything.
        "model_table": "dbo.RSLC_TX_Scores_TurnoutSupportAudiences_20260601",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.[RSLC TX Strong Republican Supporters] = '1' "
            "OR m.[RSLC TX Soft Republican Supporters] = '1' THEN 'rep' "
            "WHEN m.[RSLC TX Strong Democrat Supporters] = '1' "
            "OR m.[RSLC TX Soft Democrat Supporters] = '1' THEN 'dem' "
            "ELSE 'toss' END"
        ),
    },
    # Iowa: the V2 refresh (2026-09-05) is a real full-file model - 2,148,056 rows,
    # one per dt_regid, against roughly 2.2M registered Iowans - and it replaced both
    # the V1 candidate file and the national fallback that V1's failure forced.
    # V1 (dbo.ia_scores_audiences_20260731) was a *persuasion subset*: 354,382 rows,
    # 15% feed coverage, ~84% of absentee voters dumped into toss. V2 matches 91.3%
    # of the 2022 absentee feed and 96.1% of 2024, edging the national fallback
    # (90.8% / 95.6%) while being purpose-built for the 2026 Iowa race.
    #
    # Bucket on the 9-universe ladder (1-2 rep, 8-9 dem), NOT on the framework_*
    # flags that sit beside it, even though V2 carries both. The flags are
    # asymmetric: framework_lahn covers universe 1 alone (Lahn Base) while
    # framework_sand covers 7-9 (Available Democrats + Democrat Targets + Sand
    # Base), so bucketing on them silently drops universe 2 "Republican Targets"
    # - 262,135 voters, ~40k of the 2024 absentee feed - into toss while keeping
    # the mirror-image Dem universe. That is worth 7.9 points of margin in 2024
    # (R-5.8 on universes vs R-13.7 on flags). The ladder is the same shape as
    # GA's, with mirrored names (1 Lahn Base / 2 Republican Targets ... 8 Democrat
    # Targets / 9 Sand Base), so it gets the same 1-2 / 8-9 split. Universes 3-7
    # (Trump 2024 Overperform, Message Targets, Core Persuasion, Vulnerable
    # Middle, Available Democrats) and unmatched -> toss.
    "IA": {
        "model_table": "vs.IA_scores_audiences_20260731_V2",
        "join_col": "dt_regid",
        "bucket_sql": (
            "CASE WHEN m.universenumber IN (1, 2) THEN 'rep' "
            "WHEN m.universenumber IN (8, 9) THEN 'dem' "
            "ELSE 'toss' END"
        ),
    },
    "OR": {
        # District Explorer carries two Oregon models side by side (legislative ballot
        # and governor ballot). This is a state-legislative tracker, so it takes the
        # legislative one. Note the uppercase regid column in this table.
        "model_table": "dbo.or_audience_flags_20200727",
        "join_col": "DT_REGID",
        "bucket_sql": (
            "CASE WHEN m.state_leg_ballot_rep_audience = 1 THEN 'rep' "
            "WHEN m.state_leg_ballot_dem_audience = 1 THEN 'dem' "
            "ELSE 'toss' END"
        ),
    },
}

ACTIVE_STATES = ["VA", "WI", "AK", "RI", "PA", "NJ", "GA", "NC", "KS"]
# Every state in STATE_MODELS is wired and indexed; ACTIVE_STATES is the separate
# question of whether the AB feed actually carries it yet. A state needs BOTH a
# model and rows in dbo.General_Absentees_2026 before it belongs here.
#
# Feed contents observed 2026-09-05 (rows in General_Absentees_2026):
#   FL 1,892,416 | VA 1,503,657 | PA 919,291 | NJ 871,439 | IL 444,380
#   WI   428,058 | MN   179,329 | GA  61,729 | AK  23,232 | RI  14,105
#
#   * NC is activated but the vendor has NOT loaded it yet (0 rows on 2026-09-05,
#     though NC ballots went out 9/4). It is here on purpose: build_outputs()
#     omits a state with no activity, so NC stays invisible on the site and then
#     publishes itself on the first daily run after the feed lands. Its 2022/2024
#     history is already backfilled and does not depend on the 2026 feed.
#   * FL is new to the feed since 2026-09-01 and is the largest state in it, but
#     it has no model - it needs a STATE_MODELS entry (national fallback is fine)
#     before it can be activated.
#
#   * PA, NJ and GA were activated 2026-09-01, once each had both a model and feed
#     data. (PA had been held out because the vendor dropped it after briefly
#     loading ~526k rows; it came back.) All three are real Nov 3 generals, so they
#     take the default election day.
#   * IL and MN have feed data but no dedicated model. They would work today on
#     the national fallback, the way RI does — add a STATE_MODELS entry pointing at
#     NATIONAL_MODEL_TABLE / NATIONAL_BUCKET_SQL first.
#   * NV, AZ, MI, TX, IA and OR have models but zero feed rows so far. Adding one
#     to ACTIVE_STATES before its data lands produces an empty state, not an error.

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
    General feed, no filter). No state overrides them today; the hooks stay for
    the next primary bolt-on, which is what the MI and AK ones used."""
    table = model.get("abev_table", ABEV_TABLE)
    extra_where = model.get("extra_where", "")
    # hd_sql / extra_join let a state rebuild its house district from somewhere
    # other than the feed column. Only MD uses them today (subdistrict letters
    # from the voter file); everyone else gets the plain feed column. Kept in
    # step with historical_pull.historical_query so a state that activates
    # behaves the same way in 2026 as it does in the backfill.
    hd_sql = model.get("hd_sql", "a.LegislativeDistrict")
    extra_join = model.get("extra_join", "")
    return f"""
WITH scored AS (
    SELECT
        {hd_sql} AS hd,
        a.SenateDistrict AS sd,
        a.RequestDate,
        a.ReturnDate,
        a.EarlyVoted,
        {model['bucket_sql']} AS bucket
    FROM {table} a
    LEFT JOIN {model['model_table']} m
        ON m.{model['join_col']} = CONVERT(varchar(36), a.RNC_RegID)
    {extra_join}
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
    """Feed district value -> the 3-char id used in join keys, or "" for none.

    Numeric ids are normalised through int(), NOT by zero-padding the raw string.
    Feeds are not consistent about padding: California's 2024 file carries both
    "1" and "0001" for Assembly District 1, and zfill(3) leaves the second one at
    four characters, so it became a phantom district that joins to no shapefile
    and renders nowhere - 76,199 requests and 56,495 returns, about a third of
    that district's votes, silently missing. Going through int() collapses any
    padding to one id, and also catches "00"/"000" as the no-district sentinel
    rather than inventing district "000".

    Lettered ids (Alaska's "00B" senate, ND "04A", SD "26A") are not digits and
    pass through untouched."""
    raw = str(value or "").strip().upper()
    if not raw or raw == "NONE":
        return ""
    if raw.isdigit():
        n = int(raw)
        return "" if n == 0 else str(n).zfill(3)
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

        # A state can be activated before the vendor delivers it. Publishing it
        # with all-zero totals would read as "no absentee activity in NC", which
        # is a factual claim we can't make - so leave it out entirely until it
        # has something, and let a later run pick it up.
        if not any(statewide[stat][b] for stat in STATS for b in BUCKETS):
            print(f"[{abbr}] no activity in the feed yet - omitted from national/timeline.")
            continue

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
    source data is unchanged and we can reuse the JSON already on disk.

    The model table is part of the fingerprint even though it costs nothing to
    read: the numbers on disk depend on it just as much as on the feed, so
    pointing a state at a refreshed model has to invalidate the watermark. Without
    it a model swap leaves a state whose feed has not moved silently sitting on
    JSON built from the old model - which is exactly what would have happened to
    WI when it moved to RSLC_WI_Exchange_20260819."""
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
    return {"n": int(n or 0), "req": req, "ret": ret, "ev": ev,
            "model": model["model_table"]}


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
