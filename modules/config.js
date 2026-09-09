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
    // Washington's 2021 commission map was struck under the VRA in Soto Palmer v.
    // Hobbs; the court adopted Remedial Map 3B on 2024-03-15, effective 2024-03-28,
    // and it is still in use for 2026. Washington's senate and house share one set
    // of 49 boundaries - each district elects one senator and two representatives -
    // so the two lists are IDENTICAL by construction, and the retention test
    // independently produced the same 14 districts for both chambers.
    //
    // Measured 2022 -> 2024 on voters present in both feeds. Retention runs from
    // 19.3% (district 14) to 91.8%, with 37-94% of movers landing on a single
    // destination. The Yakima Valley remedy itself is the 14/15 pair, which
    // essentially swapped populations: 14 kept 19.3% and sent 77.7% of its voters
    // to 15.
    //
    // Six districts fall below 90% retention but are DELIBERATELY EXCLUDED because
    // their movers scatter (top destination only 11-22%): 11, 36, 37, 43, 46, 48 -
    // King and Pierce County churn, the same dense-urban false positive Illinois
    // exposed. Districts 40 and 42 are also excluded despite exchanging voters with
    // each other at 40-46% concentration: they are Whatcom/Skagit, and neither
    // county appears in the court's list of affected counties (Adams, Benton,
    // Chelan, Clark, Douglas, Franklin, Grant, King, Klickitat, Pierce, Thurston,
    // Yakima). Every one of the 14 kept below maps to a county on that list.
    //
    // Contemporary reporting said "13 legislative districts"; the measurement says
    // 14. The extra seat is defensible either way - district 7 is the weakest case
    // on county grounds (Spokane/Okanogan) but the strongest on signal, sending
    // 71.9% of its movers to district 13 (Grant, which IS on the list).
    "WA:house": [
      "002", "005", "007", "008", "009", "012", "013", "014", "015", "016", "017", "020", "031", "049"
    ],
    "WA:senate": [
      "002", "005", "007", "008", "009", "012", "013", "014", "015", "016", "017", "020", "031", "049"
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
// means "applies to all of them".
//
// KEEP THE TEXT SHORT - one phrase, two sentences at the very most. These render
// in a hover tooltip, where a paragraph does not get read. State the fact and
// stop; the reasoning, the measurements and the sources belong in CLAUDE.md.
//
// WHEN YOU ADD A STATE, ADD ITS EXCEPTIONS HERE. A quirk recorded only in a
// commit message or a code comment is invisible to everyone looking at the site.
export const STATE_DATA_NOTES = {
  "05": [{ years: [2024], text: "11.3% of 2024 records carry no district, so district counts sum short of statewide." }],
  "02": [
    { chambers: ["senate"], text: "Senate districts derived from house district pairs; the feed carries none." },
  ],
  "06": [
    { chambers: ["senate"], text: "Senate district is blank on ~1.2% of records, missing from the senate rollup only." },
    { years: [2022], text: "2022 model match is 82.5% against 90.4% in 2024, inflating that year's Swing bucket." },
  ],
  "09": [
    { years: [2022], stats: ["ev"], text: "Connecticut had no early voting until 2024; the 2022 zero is correct." },
  ],
  "16": [
    { years: [2024], stats: ["ev"], text: "2024 early-vote data was never delivered; the zero is a gap, not Idaho law." },
    { chambers: ["senate"], text: "Senate district is blank on 2-4% of records, missing from the senate rollup only." },
  ],
  "17": [
    { years: [2022], chambers: ["senate"], text: "2022 senate districts are rebuilt from the house districts nested inside them." },
  ],
  "21": [
    { years: [2024], text: "Kentucky is absent from the 2024 feed entirely." },
    { years: [2022], text: "All 2022 records share one placeholder date; totals are sound, daily and trend views are not." },
  ],
  "24": [
    { chambers: ["house"], text: "House subdistricts rebuilt from the voter file; 85-92% attribution in the 18 subdivided districts." },
  ],
  "25": [{ text: "Massachusetts is not loaded: no 2022 records, and its district codes do not map to district numbers." }],
  "29": [{ text: "Requests only; Missouri's feed carries no return or early-vote records." }],
  "30": [
    { stats: ["ev"], text: "Early-vote records are missing from the feed; Montana does allow in-person absentee voting." },
  ],
  "33": [
    { text: "Margins calculated using gubernatorial model." },
    { stats: ["ev"], text: "No in-person early voting in New Hampshire." },
    { chambers: ["house"], text: "Floterial district votes not included in statewide totals." },
  ],
  "36": [{ text: "Assembly and Senate lines changed for 2024; affected districts read N/A for 2022." }],
  "37": [{ text: "Margins calculated using the national model; no usable North Carolina model exists." }],
  "38": [
    { chambers: ["house"], text: "House district 4's subdistricts (4A/4B) rebuilt from the voter file." },
    { years: [2024], text: "8.7% of 2024 records carry no district, so district counts sum short of statewide." },
  ],
  "39": [{ text: "Margins calculated using generic congressional ballot model." }],
  "41": [
    { stats: ["ev"], text: "Oregon votes entirely by mail; Early Vote is zero by design." },
    { years: [2022], stats: ["requested"], text: "No request dates in the 2022 feed." },
  ],
  "44": [
    { stats: ["returned", "ev"], text: "All records are permanent-absentee signups; Returned and Early Vote are zero by design." },
  ],
  "46": [
    { chambers: ["house"], text: "House subdistricts (26A/B, 28A/B) rebuilt from the voter file." },
  ],
  "47": [
    { stats: ["requested", "returned"], text: "No no-excuse absentee voting in Tennessee; early votes only." },
  ],
  "48": [
    { years: [2022, 2024], stats: ["requested"], text: "No request dates in either historical year." },
  ],
  "53": [
    { stats: ["ev"], text: "Washington votes by mail; Early Vote is a 0.3% rounding error by design." },
  ],
  "56": [
    { years: [2022], text: "2022 dropped: 62 returns against 57,634 requests made the year unusable." },
    { text: "Lowest model match of any state (78-82%), so the Swing bucket is inflated." },
  ],
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
// Empty since 2026-09-09, when the VA and WI spring test data was retired and
// both states moved to the November calendar. Kept because the next off-cycle
// contest will need it: add the state's FIPS and its real election day, and pair
// it with an ElectionType filter in daily_update so the off-cycle rows are the
// only ones counted.
export const ELECTION_DAY_OVERRIDES = {};

// First day of each state's ABEV window; chrono tables fold anything earlier
// into the "Earlier" row. TODO: fill in from a full state-by-state table.
export const ABEV_START_OVERRIDES = {
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
