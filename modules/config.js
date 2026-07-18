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

// The four tracked stats. "voted" is calculated client-side as returned + ev.
export const STAT_VIEWS = ["requested", "returned", "ev", "voted"];

export const STAT_LABELS = {
  requested: "ABs Requested",
  returned: "ABs Returned",
  ev: "Early Votes",
  voted: "Total Votes",
};

export const STAT_SHORT_LABELS = {
  requested: "Requested",
  returned: "Returned",
  ev: "Early Votes",
  voted: "Total Votes",
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
