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
export const HISTORY_STALE_LINES = {
  2022: ["VA", "WI", "NC"],
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
  "37": {
    missingYear: 2022,
    note: "North Carolina redrew its state legislative maps in October 2023 - data from 2022 is not applicable to the 2026 election.",
  },
};

// Raw stats: requested / returned / ev; "voted" is calculated as returned + ev.
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
