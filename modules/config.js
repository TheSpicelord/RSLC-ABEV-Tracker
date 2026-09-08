export const NATIONAL_CENTER = [39.5, -98.35];
export const NATIONAL_ZOOM = 4;
export const BASE_WHEEL_PX_PER_ZOOM_LEVEL = 60;
export const CTRL_WHEEL_ZOOM_SLOW_FACTOR = 5;
export const BASE_ZOOM_SNAP = 1;
export const CTRL_FINE_ZOOM_SNAP = 0.2;

// Password gate (same Cloudflare Worker as District Explorer).
// Set to false to disable while developing / until a worker is configured for this site.
export const AUTH_ENABLED = true;
export const AUTH_WORKER_URL = "https://districts.rslc.gop/auth";

export const AUTO_SHAPE_URLS = {
  states: "data/shapes/states.zip",
  house: "data/shapes/house.zip",
  senate: "data/shapes/senate.zip",
  nh_house_floterial: "data/shapes/nh_house_floterial.zip",
};

export const ABEV_INDEX_URL = "data/abev/abev_files.json";
export const ABEV_NATIONAL_URL = "data/abev/national.json";
export const ABEV_TIMELINE_URL = "data/abev/timeline.json";
export const ABEV_HISTORY_INDEX_URL = "data/abev/history/history.json";

// Past general elections shown alongside the current cycle. Election days are
// the real ones for those years (historical_pull.py YEAR_CONFIG) — "On This Day"
// aligns each year by days-out from its own election day, so they must match.
export const HISTORY_YEARS = [2022, 2024];
export const HISTORY_ELECTION_DAYS = {
  2022: "2022-11-08",
  2024: "2024-11-05",
};

// Past cycles whose ABEV can't be mapped onto today's districts, because the
// state redrew its lines in between. The columns are still rendered so the
// years line up across states, but every value reads N/A rather than a count
// that belongs to a different map.
//
// An entry is either a plain abbr ("WI" - both chambers stale that year) or an
// abbr qualified by chamber ("MI:senate" - that chamber only). Use this list
// only where a redraw was broad enough that no district survived it intact; a
// partial redraw belongs in HISTORY_STALE_DISTRICTS below, which keeps the
// untouched districts readable.
export const HISTORY_STALE_LINES = {
  2022: ["VA", "WI", "NC", "MT"],
};

// Partial redraws: only the listed districts are N/A, the rest keep real counts.
// Keyed year -> "ABBR:chamber" -> district ids as they appear in a join key.
//
// A redraw almost never touches a whole chamber. Michigan is the case in hand:
// *Agee v. Benson* struck 13 districts in 2024 and the remedial maps changed
// those plus the neighbours needed to rebalance them, leaving most of the state
// on identical lines. Blanking all 110 house seats to protect 14 of them threw
// away comparable data for 96 districts, which is what this fixes.
//
//   House  - 2022 ran on the MICRC's original Hickory plan; the remedial Motown
//            Sound A1 was used in 2024 and again in 2026. The change is confined
//            to the contiguous Detroit-area block, districts 1-14, so 2022 is
//            stale for those and directly comparable for the other 96. 2024
//            house ABEV needs no entry at all - same lines as 2026.
// The senate list is the ELECTION WORKBOOK's, not the one enumerated in the
// tracker's CLAUDE.md shapefile note. The two agree on 12 of 14 and disagree on
// exactly two: the workbook has SD 4 and not SD 38, CLAUDE.md has SD 38 and not
// SD 4. The workbook's set is 1-11 plus 13, 23, 24 - a contiguous metro-Detroit
// block, which is what the Agee v. Benson remedy actually covered - while
// CLAUDE.md's skips 4 in the middle of that block and reaches instead for 38,
// the Upper Peninsula, nowhere near it. That reads as a transcription slip in a
// list written as "1, 2, 3, 5-11, 13, 23, 24, 38" where "1-11, 13, 23, 24" was
// meant. The workbook also drives the leg_2022 column, so following it keeps the
// two columns consistent per district; following CLAUDE.md would put a live 2022
// leg margin beside an N/A 2022 ABEV cell in SD 38 and the reverse in SD 4.
// Worth confirming against the Crane A1 / Linden geometry when someone has both.
//   Senate - 2022 and 2024 BOTH ran on Linden: senate terms are four years, so
//            the seats went 2022 -> 2026 with no 2024 election and the feed
//            still carried Linden assignments that year. Crane A1 is first used
//            in 2026 and differs from Linden in 14 of 38 districts, so both past
//            cycles are stale for exactly those and fine for the other 24.
//
// The house list was derived from the voter file rather than assumed: joining
// the 2022 and 2024 absentee feeds on RNC_RegID and asking how many of a
// district's voters kept the same district label separates a redraw from
// ordinary relocation cleanly. Districts 1-14 sit at 0.3-67% retention against a
// 88-98% band for the rest. District 2 is the one that needs the second test -
// it retains 88.3%, inside the band, but 51% of the voters it did lose landed in
// district 1 alone, a boundary shift rather than the thin scatter to neighbours
// that ordinary movement produces. The senate list comes from the shapefile
// splice documented in CLAUDE.md; the same voter-file test confirms 2024 senate
// is still Linden, showing no redraw signal between 2022 and 2024 at all.
//
// Statewide totals are NOT affected by any of this - a state's borders don't
// move when its districts do - so statewide chrono and trend keep every year.
export const HISTORY_STALE_DISTRICTS = {
  2022: {
    "MI:house": ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012", "013", "014"],
    "MI:senate": ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "013", "023", "024"],
    // Georgia's 2021 maps were used in 2022, then redrawn under the Dec 2023
    // court order in Georgia v. Kemp (Section 2); the new lines were used in
    // 2024 and again in 2026. Verified both ways against the voter file: 2022 ->
    // 2024 moves these districts, and 2024 -> 2026 moves nothing at all (median
    // retention 96.5% house / 97.5% senate, no district under 80%), so 2024 GA
    // ABEV is directly comparable and needs no entry.
    "GA:house": [
      "003", "012", "013", "019", "034", "035", "036", "037", "040", "042",
      "043", "055", "056", "057", "058", "060", "061", "064", "065", "066",
      "074", "078", "081", "082", "084", "085", "086", "087", "089", "090",
      "091", "092", "093", "094", "095", "101", "102", "105", "106", "107",
      "108", "109", "110", "111", "112", "113", "114", "115", "116", "117",
      "118", "133", "134", "135", "142", "143", "144", "145", "149", "177"
    ],
    "GA:senate": [
      "002", "006", "010", "015", "017", "025", "028", "030", "033", "035",
      "038", "039", "041", "042", "043", "044", "053", "055"
    ],
    // Alaska's 2021 board map was litigated through the 2022 election (In re 2021
    // Redistricting Cases); the final map took effect for 2024 and is still in
    // use for 2026. The changes are concentrated in Anchorage (18-20, 22, 23)
    // with a smaller pairing change at 3/4 and 7/8. Districts 38 and 40 look
    // low on retention (73-80%) but are NOT redrawn: they are rural seats with
    // only 35-38 movers between them, and those movers scatter (11% top
    // destination) instead of landing in one neighbour, so the low number is
    // ordinary relocation in a small sample. Senate letters follow from the
    // house pairing Alaska statute defines - A = HD 1-2, B = 3-4 and so on - so
    // the affected senate seats are exactly those covering a changed house seat.
    // New York redrew both chambers after the 2022 maps were litigated: the
    // Assembly plan was replaced for 2024 (Hoffmann v. IRC) and the Senate lines
    // moved with it. The change is narrow. Senate 6-9 is the Nassau/Long Island
    // cluster and unmistakable - 48-84% retention with 46-91% of movers landing
    // in one neighbour. Assembly 30, 42, 115, 132 fail on retention alone
    // (56-78%); 34, 39 and 133 sit at 83-89% but send 40-53% of their movers to
    // a single district, which is the boundary-shift signature rather than the
    // thin scatter of ordinary relocation.
    //
    // The rest of the NYC tail (districts at 82-91% retention with scattered
    // movers) is deliberately NOT listed. That is the same false-positive mode
    // Illinois exposed: a dense-city district borders few enough neighbours that
    // normal movement piles into one of them. Retention is the primary test here
    // and concentration only promotes a district that is already suspicious.
    //
    // Checked 2022 -> 2024 only. NY has no rows in the 2026 feed, so whether the
    // 2024 lines survive into 2026 is UNVERIFIED - re-run the retention test
    // when NY data lands.
    "NY:house": ["030", "034", "039", "042", "115", "132", "133"],
    "NY:senate": ["006", "007", "008", "009"],
    "AK:house": [
      "003", "004", "007", "008", "018", "019", "020", "022", "023"
    ],
    "AK:senate": [
      "00B", "00D", "00I", "00J", "00K", "00L"
    ],
  },
  2024: {
    "MI:senate": ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "013", "023", "024"],
  },
};

export const CHAMBER_NAMES_URL = "data/state_chamber_names.json";

// District Explorer is the single source of truth for target tiers, incumbents,
// and past legislative margins — all generated from
// "data/State Legislative Election History.xlsx" in that project by
// scripts/generate_chamber_jsons.py. We never keep a second copy of that
// workbook or its output; we read DE's generated JSON directly.
//
// Bases are tried in order. The relative path is the sibling project folder
// (works when both are served from the shared "Coding Projects" parent); the
// hosted DE site is the fallback for GitHub Pages, where the sibling folder
// isn't reachable.
export const DE_DATA_BASES = [
  "../RSLC-District-Explorer/data/",
  "https://districts.rslc.gop/data/",
];

// Footnote for a state whose current lines postdate an older election, shown
// whenever that year reads N/A on screen — a leg-margin column, a past-cycle
// ABEV column, or both. `legColumn: false` where the state simply held no
// legislative election that year (VA's are odd-year), so the note applies to the
// ABEV columns only and no empty leg-margin column should be invented for it.
export const LEG_REDISTRICTING_NOTES = {
  "51": {
    missingYear: 2022,
    legColumn: false,
    note: "2022 ABEV data not available under current state legislative boundaries.",
  },
  "55": {
    missingYear: 2022,
    note: "Wisconsin redrew its state legislative maps in 2023 - data from 2022 is not applicable to the 2026 election.",
  },
  // NC's 2022 legislative elections ran on the court-supervised interim maps
  // (SL 2022-2 Senate / SL 2022-4 House). The General Assembly replaced both on
  // 2023-10-25 (SL 2023-146 / SL 2023-149); those are the lines used in 2024 and
  // again in 2026, so 2024 ABEV is comparable and 2022 is not. The state
  // constitution allows only one legislative redraw per census, so the Oct 2025
  // mid-decade redistricting was congressional-only and left these untouched.
  // Montana's redistricting commission did not deliver its post-2020-census
  // legislative maps until 2023-02-22, too late for that cycle, so the 2022
  // election ran on the OLD (2013) districts and 2024 was the first vote on the
  // current lines. District NUMBERS survived - 100 house, 50 senate in both - so
  // nothing about a 2022 Montana row looks wrong; it is simply a different map.
  "30": {
    missingYear: 2022,
    note: "Montana's 2022 election ran on the pre-2020-census districts - the current maps were not adopted until February 2023 and were first used in 2024.",
  },
  "37": {
    missingYear: 2022,
    note: "North Carolina redrew its state legislative maps in October 2023 - data from 2022 is not applicable to the 2026 election.",
  },
  // New York: Assembly replaced for 2024 after Hoffmann v. IRC, Senate lines
  // moved with it. 7 of 150 Assembly and 4 of 63 Senate districts affected.
  "36": {
    missingYear: 2022,
    note: "New York's legislative maps were redrawn after the 2022 election - the replacement lines were used in 2024. ABEV data is shown for the districts whose lines did not move and reads N/A for those that did.",
  },
  // Georgia: court-ordered mid-decade redraw, Dec 2023. 60 of 180 house and 18
  // of 56 senate districts moved; the rest are comparable back to 2022.
  "13": {
    missingYear: 2022,
    note: "Georgia redrew part of its state legislative map under a December 2023 court order - the new lines were used in 2024 and 2026. ABEV data is shown for the districts whose lines did not move and reads N/A for those that did.",
  },
  // Alaska: the 2021 board map was litigated through 2022; the final map took
  // effect in 2024. Senate districts are letters built from house pairs.
  "02": {
    missingYear: 2022,
    note: "Alaska's district lines were still in litigation for the 2022 election and were finalized for 2024. ABEV data is shown for the districts whose lines did not move and reads N/A for those that did.",
  },
  // Michigan: see HISTORY_STALE_DISTRICTS above. Only the redrawn districts read
  // N/A, so this footnote says "some districts" rather than claiming the whole
  // cycle is unusable. missingYear is the earliest affected year, used only to
  // stand up an N/A leg-margin column.
  "26": {
    missingYear: 2022,
    note: "Michigan redrew part of its state legislative map after Agee v. Benson - House districts 1-14 changed for 2024, and 14 of 38 Senate districts change for 2026. ABEV data is shown for the districts whose lines did not move and reads N/A for those that did.",
  },
};

// Raw stats: requested / returned / ev; "voted" is calculated as returned + ev.
// Per-state data exceptions - the things a reader would otherwise misread as a
// bug or as missing data. This is the machine-readable companion to the prose in
// CLAUDE.md, and it is what drives the circled-i next to a state's name.
//
// SCOPE: this list is for DATA quirks - a stat that is zero by design, a year the
// vendor never delivered, a district id rebuilt from somewhere other than the
// feed. Redistricting is NOT here: it has its own machinery in
// HISTORY_STALE_LINES / HISTORY_STALE_DISTRICTS / LEG_REDISTRICTING_NOTES above,
// which blanks the affected cells rather than merely annotating them.
//
// Each note may be narrowed by `years`, `stats` and `chambers`; omitting a key
// means "applies to all of them". Keep `text` to something a non-technical
// reader can act on - it is rendered verbatim in a tooltip.
//
// WHEN YOU ADD A STATE, ADD ITS EXCEPTIONS HERE. A quirk recorded only in a
// commit message or a code comment is invisible to everyone looking at the site.
export const STATE_DATA_NOTES = {
  "02": [{
    chambers: ["senate"],
    text: "Alaska's feed carries no senate district, so each senate district is derived from its two house districts (A = HD 1-2, B = 3-4, and so on).",
  }],
  "09": [{
    years: [2022], stats: ["ev"],
    text: "Connecticut had no in-person early voting until 2024, so its 2022 Early Vote total is correctly zero rather than missing.",
  }],
  "16": [
    { years: [2024], stats: ["ev"],
      text: "Idaho's 2024 early-vote column was never delivered, so it reads zero. Idaho did hold early voting in 2024 - its 2022 file carries 51,459 early votes - so this is a gap in the data, not a change in Idaho law." },
    { chambers: ["senate"],
      text: "Idaho's feed leaves the senate district blank on 4.4% of 2024 rows and 2.2% of 2022 rows, even though Idaho's senate and house share one district number. Those voters are missing from the senate rollup but present in the house and statewide totals." },
  ],
  "17": [{
    years: [2022], chambers: ["senate"],
    text: "Illinois' 2022 feed has a corrupt SenateDistrict column. The senate district is rebuilt from the two house districts nested inside it, which holds for 100% of Illinois rows.",
  }],
  "21": [
    { years: [2024],
      text: "Kentucky is absent from the 2024 absentee feed entirely - it carries 49 states and Kentucky is not one of them - so Kentucky has no 2024 data at all." },
    { years: [2022],
      text: "Every Kentucky 2022 row carries the same placeholder date: 11/8 for mail, 11/5 for early voting. District totals and margins are sound, but the day-by-day and trend views are not meaningful." },
  ],
  "24": [{
    chambers: ["house"],
    text: "Maryland elects delegates from 71 units, which its feed cannot express, so the subdistrict letter is rebuilt from the voter file. Attribution in the 18 subdivided districts is 84.8% for 2022 and 92.1% for 2024; the other 29 are complete.",
  }],
  "25": [{
    text: "Massachusetts is deliberately not loaded. It has no 2022 rows at all, and its feed's district columns are internal codes (0-337) rather than district numbers, so nothing joins.",
  }],
  "30": [{
    stats: ["ev"],
    text: "Montana's feed carries no early-vote rows in either year, so Early Vote reads zero. Unlike Tennessee or Oregon this is not a rule of the state - Montana does allow in-person absentee voting from 30 days out - the votes simply are not in the data.",
  }],
  "36": [{
    text: "New York's Assembly plan was replaced for 2024 and the Senate lines moved with it, so the affected districts read N/A for 2022. Whether the 2024 lines carry into 2026 is unverified - New York has no 2026 feed rows yet.",
  }],
  "37": [{
    text: "North Carolina's modeled lean uses the national model. The one North Carolina file on the server is a GOP targeting file rather than a partisan classification, and would have put the 2024 absentee electorate at R+29.7 against an actual result of R+3.",
  }],
  "38": [
    { chambers: ["house"],
      text: "North Dakota's House district 4 is split into 4A and 4B, but the feed carries only \"4\", so the subdistrict is rebuilt from the voter file." },
    { years: [2024],
      text: "8.7% of North Dakota's 2024 rows carry no district at all. Those voters count in the statewide total, so North Dakota's district counts sum short of it." },
  ],
  "41": [
    { stats: ["ev"],
      text: "Oregon votes entirely by mail, so its Early Vote total is legitimately zero." },
    { years: [2022], stats: ["requested"],
      text: "Oregon's 2022 feed carries no request dates, so Requested is zero for that year." },
  ],
  "44": [{
    stats: ["returned", "ev"],
    text: "Every Rhode Island row is a permanent-absentee list signup, so Returned and Early Vote are zero by design.",
  }],
  "46": [{
    chambers: ["house"],
    text: "South Dakota's House districts 26 and 28 are each split into A and B halves, but the feed carries only the number, so the subdistrict is rebuilt from the voter file.",
  }],
  "47": [{
    stats: ["requested", "returned"],
    text: "Tennessee has no no-excuse absentee voting and its feed carries only early in-person votes, so Requested and Returned are zero by design - the mirror of Rhode Island.",
  }],
  "48": [{
    years: [2022, 2024], stats: ["requested"],
    text: "Texas carries no request dates in either historical year, so its Requested view is zero for 2022 and 2024. Returned and Early Vote are unaffected.",
  }],
  "56": [
    { years: [2022],
      text: "Wyoming has no 2022 column because that year's file was unusable: 57,634 requests against just 62 returns and no early votes at all. It was dropped rather than shown as a column that is 99.9% empty. 2024 is healthy (37,563 / 34,499 / 81,211), so this is a gap specific to 2022, not how Wyoming votes." },
    { text: "Wyoming matches the national model at 78-82%, the lowest of any backfilled state (most run 88-98%). Unmatched voters fall to Swing, so Wyoming's Swing bucket is inflated relative to other states and its GOP/Dem margin is correspondingly damped." },
  ],
  "51": [{
    years: [2026],
    text: "Virginia's 2026 numbers come from the April referendum, which is being used as test data. They are not the November general election.",
  }],
  "55": [{
    years: [2026],
    text: "Wisconsin's 2026 numbers come from the April Supreme Court race, which is being used as test data. They are not the November general election.",
  }],
};

export const STAT_LABELS = {
  requested: "ABs Requested",
  returned: "ABs Returned",
  ev: "Early Votes",
  voted: "Total Votes",
};

// The three display views. Each drives the sidebar table layout and the stat
// used for map coloring.
export const ABEV_VIEWS = ["ab", "ev", "abev"];

export const VIEW_BUTTON_LABELS = {
  ab: "Absentees",
  ev: "Early Votes",
  abev: "ABEV Total",
};

export const VIEW_CARD_LABELS = {
  ab: "Absentee Votes",
  ev: "Early Votes",
  abev: "ABEV Totals",
};

export const VIEW_MAP_STAT = {
  ab: "returned",
  ev: "ev",
  abev: "voted",
};

// Chronological views never display dates past election day.
// Overrides cover the spring-2026 test elections; everything else is Nov 3.
export const DEFAULT_ELECTION_DAY = "2026-11-03";
export const ELECTION_DAY_OVERRIDES = {
  "51": "2026-04-21", // VA referendum (test data)
  "55": "2026-04-07", // WI Supreme Court (test data)
};

// First day of each state's ABEV window; chrono tables fold anything earlier
// into the "Earlier" row. TODO: fill in from a full state-by-state table.
export const ABEV_START_OVERRIDES = {
  "51": "2026-03-06", // VA (test)
  "55": "2026-03-17", // WI (test)
  "02": "2026-01-01", // AK — perm-AB signups, run all cycle
  "44": "2026-01-01", // RI — perm-AB signups, run all cycle
  "42": "2026-01-01", // PA — annual mail-in list, requests run all cycle
};

export const STATE_NAME_TO_ABBR = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

export const OVERSEAS_TERRITORY_FIPS = new Set(["60", "66", "69", "72", "78"]);
export const OVERSEAS_TERRITORY_ABBR = new Set(["AS", "GU", "MP", "PR", "VI"]);
