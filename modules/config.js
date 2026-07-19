export const NATIONAL_CENTER = [39.5, -98.35];
export const NATIONAL_ZOOM = 4;
export const BASE_WHEEL_PX_PER_ZOOM_LEVEL = 60;
export const CTRL_WHEEL_ZOOM_SLOW_FACTOR = 5;
export const BASE_ZOOM_SNAP = 1;
export const CTRL_FINE_ZOOM_SNAP = 0.2;

// Password gate (same Cloudflare Worker as District Explorer).
// Set to false to disable while developing / until a worker is configured for this site.
export const AUTH_ENABLED = false;
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
export const CHAMBER_NAMES_URL = "data/state_chamber_names.json";

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
