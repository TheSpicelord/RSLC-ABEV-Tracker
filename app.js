import { requireAuth } from "./modules/auth.js";
import {
  ABEV_HISTORY_INDEX_URL,
  ABEV_INDEX_URL,
  ABEV_NATIONAL_URL,
  ABEV_START_OVERRIDES,
  ABEV_TIMELINE_URL,
  ABEV_VIEWS,
  AUTH_ENABLED,
  AUTH_WORKER_URL,
  AUTO_SHAPE_URLS,
  BASE_WHEEL_PX_PER_ZOOM_LEVEL,
  BASE_ZOOM_SNAP,
  CHAMBER_NAMES_URL,
  CTRL_FINE_ZOOM_SNAP,
  CTRL_WHEEL_ZOOM_SLOW_FACTOR,
  DE_DATA_BASES,
  DEFAULT_ELECTION_DAY,
  ELECTION_DAY_OVERRIDES,
  HISTORY_ELECTION_DAYS,
  HISTORY_STALE_LINES,
  HISTORY_YEARS,
  LEG_REDISTRICTING_NOTES,
  NATIONAL_CENTER,
  NATIONAL_ZOOM,
  OVERSEAS_TERRITORY_ABBR,
  OVERSEAS_TERRITORY_FIPS,
  STAT_LABELS,
  VIEW_BUTTON_LABELS,
  VIEW_CARD_LABELS,
  VIEW_MAP_STAT,
} from "./modules/config.js";
import {
  details,
  detailsTitle,
  exitStateBtn,
  houseChamberBtn,
  sampleBadge,
  senateChamberBtn,
  stateSelect,
  statusText,
  statViewButtons,
  targetDistrictsToggle,
  updatedBadge,
  upIn2026Toggle,
} from "./modules/dom.js";
import { state } from "./modules/state.js";
import { ABEV_SCHEDULE, ABEV_SCHEDULE_LABEL } from "./modules/schedule.js";

if (AUTH_ENABLED) {
  await requireAuth(AUTH_WORKER_URL);
}

const BUILD_VERSION = "20260801c";

function withCacheBust(url) {
  const text = String(url || "").trim();
  if (!text) return text;
  return text.includes("?") ? `${text}&v=${BUILD_VERSION}` : `${text}?v=${BUILD_VERSION}`;
}

// ---------------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------------

const map = L.map("map").setView(NATIONAL_CENTER, NATIONAL_ZOOM);
map.boxZoom.disable();
map.options.wheelPxPerZoomLevel = BASE_WHEEL_PX_PER_ZOOM_LEVEL;
map.options.zoomSnap = BASE_ZOOM_SNAP;
map.options.zoomDelta = BASE_ZOOM_SNAP;

map.createPane("statePane");
map.getPane("statePane").style.zIndex = 330;
map.createPane("districtPane");
map.getPane("districtPane").style.zIndex = 420;
map.createPane("districtNumberPane");
map.getPane("districtNumberPane").style.zIndex = 452;
map.createPane("stateHoverPane");
map.getPane("stateHoverPane").style.zIndex = 454;
map.createPane("districtHoverPane");
map.getPane("districtHoverPane").style.zIndex = 455;
map.createPane("placeLabelPane");
map.getPane("placeLabelPane").style.zIndex = 460;
map.getPane("placeLabelPane").style.pointerEvents = "none";

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
  maxZoom: 18,
  subdomains: "abcd",
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
}).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", {
  pane: "placeLabelPane",
  maxZoom: 18,
  minZoom: 13,
  subdomains: "abcd",
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  interactive: false,
}).addTo(map);

init().catch((err) => {
  console.error(err);
  setStatus(`Startup error: ${err.message}`);
});

async function init() {
  wireEvents();
  initHoverInfo();
  initChamberOverviewButton();
  initTrendChart();
  renderViewButtons();

  detailsTitle.textContent = "National Overview";
  setDetailsLoading("Loading ABEV data...");
  resetSidebarScroll();

  await Promise.all([loadAbevData(), autoLoadStateShapes()]);
  renderDataBadges();
  enterNationalView();
}

// ---------------------------------------------------------------------------
// ABEV data loading
// ---------------------------------------------------------------------------

async function loadAbevData() {
  const index = await fetchJson(ABEV_INDEX_URL);
  const houseUrls = Array.isArray(index?.house) ? index.house : [];
  const senateUrls = Array.isArray(index?.senate) ? index.senate : [];

  const [houseFiles, senateFiles, national, timeline, chamberNames] = await Promise.all([
    Promise.all(houseUrls.map((url) => fetchJson(url))),
    Promise.all(senateUrls.map((url) => fetchJson(url))),
    fetchJson(index?.national || ABEV_NATIONAL_URL),
    fetchJson(index?.timeline || ABEV_TIMELINE_URL),
    fetchJson(CHAMBER_NAMES_URL),
  ]);

  state.dataByChamber.house = buildDataMap(houseFiles);
  state.dataByChamber.senate = buildDataMap(senateFiles);

  state.nationalByFips = new Map();
  for (const rec of national?.states || []) {
    const fips = normalizeStateFips(rec.state_fips);
    if (fips) state.nationalByFips.set(fips, rec);
  }

  state.timelineByFips = new Map();
  for (const [fips, rec] of Object.entries(timeline?.states || {})) {
    const normalized = normalizeStateFips(fips);
    if (normalized) state.timelineByFips.set(normalized, rec);
  }

  state.chamberNamesByState = new Map();
  if (chamberNames && typeof chamberNames === "object") {
    for (const [key, value] of Object.entries(chamberNames)) {
      if (typeof value === "string" && value.trim()) state.chamberNamesByState.set(key, value.trim());
    }
  }

  state.updatedDate = String(national?.updated || index?.updated || "");
  state.isSampleData = Boolean(national?.sample || index?.sample);
}

function buildDataMap(files) {
  const m = new Map();
  for (const file of files) {
    if (!file) continue;
    const stateFips = normalizeStateFips(file.state_fips);
    const stateAbbr = String(file.state_abbr || "").toUpperCase();
    for (const d of file.districts || []) {
      const districtId = normalizeDistrictId(d.district_id);
      if (!stateFips || !districtId) continue;
      m.set(makeJoinKey(stateFips, districtId), {
        ...d,
        state_fips: stateFips,
        state_abbr: stateAbbr,
      });
    }
  }
  return m;
}

async function fetchJson(url) {
  try {
    const response = await fetch(withCacheBust(url));
    if (!response.ok) return null;
    return await response.json();
  } catch (_err) {
    return null;
  }
}

function renderDataBadges() {
  if (updatedBadge) {
    updatedBadge.hidden = !state.updatedDate;
    updatedBadge.textContent = state.updatedDate ? `Data as of ${state.updatedDate}` : "";
  }
  if (sampleBadge) {
    sampleBadge.hidden = !state.isSampleData;
  }
}

// ---------------------------------------------------------------------------
// Stat helpers
// ---------------------------------------------------------------------------

const EMPTY_BUCKETS = { rep: 0, dem: 0, toss: 0 };

function bucketsForStat(rec, stat) {
  if (!rec) return null;
  if (stat === "voted") {
    const returned = rec.returned || EMPTY_BUCKETS;
    const ev = rec.ev || EMPTY_BUCKETS;
    return {
      rep: Number(returned.rep || 0) + Number(ev.rep || 0),
      dem: Number(returned.dem || 0) + Number(ev.dem || 0),
      toss: Number(returned.toss || 0) + Number(ev.toss || 0),
    };
  }
  const raw = rec[stat];
  if (!raw) return null;
  return {
    rep: Number(raw.rep || 0),
    dem: Number(raw.dem || 0),
    toss: Number(raw.toss || 0),
  };
}

// Net convention for this project: positive = GOP advantage, negative = Dem.
function statTotals(rec, stat) {
  const buckets = bucketsForStat(rec, stat);
  if (!buckets) return null;
  const total = buckets.rep + buckets.dem + buckets.toss;
  return { ...buckets, total, net: buckets.rep - buckets.dem };
}

function sumStatTotals(records, stat) {
  const out = { rep: 0, dem: 0, toss: 0, total: 0, net: 0 };
  for (const rec of records) {
    const totals = statTotals(rec, stat);
    if (!totals) continue;
    out.rep += totals.rep;
    out.dem += totals.dem;
    out.toss += totals.toss;
    out.total += totals.total;
  }
  out.net = out.rep - out.dem;
  return out;
}

function netPctForRecord(rec, stat) {
  const totals = statTotals(rec, stat);
  if (!totals || totals.total <= 0) return null;
  return (totals.net / totals.total) * 100;
}

// Stats shown in detail/hover breakdowns (all four raw + calculated stats).
const DETAIL_STATS = ["requested", "returned", "ev", "voted"];
const DETAIL_STAT_SHORT = {
  requested: "Requested",
  returned: "Returned",
  ev: "Early Votes",
  voted: "Total Votes",
};

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US");
}

// All displayed margins are percentages of the stat total: R+5.4 / D+3.2.
function formatNetPct(netPct) {
  if (typeof netPct !== "number") return "N/A";
  if (Math.abs(netPct) < 0.05) return "EVEN";
  const abs = Math.abs(netPct).toFixed(1);
  return netPct > 0 ? `R+${abs}` : `D+${abs}`;
}

function netClass(netPct) {
  if (typeof netPct !== "number" || Math.abs(netPct) < 0.05) return "net-even";
  return netPct > 0 ? "net-r" : "net-d";
}

function netPctHtml(netPct) {
  return `<span class="${netClass(netPct)}">${escapeHtml(formatNetPct(netPct))}</span>`;
}

function netPctFromTotals(totals) {
  if (!totals || totals.total <= 0) return null;
  return (totals.net / totals.total) * 100;
}

// District-Explorer-style margin cell: signed percentage on a colored field.
function marginCellHtml(netPct, extraClass = "") {
  if (typeof netPct !== "number") {
    return `<td class="margin-cell margin-cell-na${extraClass}">N/A</td>`;
  }
  const sign = netPct >= 0 ? "+" : "-";
  const text = `${sign}${Math.abs(netPct).toFixed(1)}`;
  return `<td class="margin-cell${extraClass}" style="background:${netColor(netPct)}">${escapeHtml(text)}</td>`;
}

// The stat used for map coloring / highlights under the active view.
function mapStat() {
  return VIEW_MAP_STAT[state.abevView] || "voted";
}

// Fill color from net advantage as a share of the stat total.
// Red = GOP advantage, blue = Dem advantage (note: reversed sign convention
// from District Explorer, which stores Dem-positive margins).
// Hue saturates at a ±20% margin.
function netColor(netPct) {
  if (typeof netPct !== "number") return "#d5dae0";
  if (Math.abs(netPct) < 0.0001) return "#f0f2f5";
  if (netPct > 0) return interpolateHex("#ffd4dc", "#F82644", Math.min(netPct, 20) / 20);
  return interpolateHex("#cfe2ff", "#257BF8", Math.min(Math.abs(netPct), 20) / 20);
}

function statCellHtml(rec, stat) {
  const totals = rec ? statTotals(rec, stat) : null;
  const selected = mapStat() === stat ? " stat-col-selected" : "";
  if (!totals || totals.total <= 0) {
    return `<td class="stat-cell${selected}"><span class="stat-cell-count">—</span></td>`;
  }
  const netPct = netPctFromTotals(totals);
  return `
    <td class="stat-cell${selected}">
      <span class="stat-cell-count">${escapeHtml(formatCount(totals.total))}</span>
      <span class="stat-cell-net ${netClass(netPct)}">${escapeHtml(formatNetPct(netPct))}</span>
    </td>
  `;
}

// ---------------------------------------------------------------------------
// District Explorer data (targets, incumbents, past legislative margins)
//
// Read straight from the sibling District Explorer project, which generates it
// from "State Legislative Election History.xlsx". That workbook stays the one
// source of truth — nothing is copied into this repo. Fetched lazily per
// state+chamber so selecting a state doesn't pull all ~99 files.
// ---------------------------------------------------------------------------

async function fetchDeJson(fileName) {
  // Once a base answers, keep using it instead of re-probing the dead one.
  const bases = state.deBaseUrl ? [state.deBaseUrl] : DE_DATA_BASES;
  for (const base of bases) {
    try {
      const response = await fetch(withCacheBust(base + fileName));
      if (!response.ok) continue;
      const json = await response.json();
      state.deBaseUrl = base;
      return json;
    } catch (_err) {
      // Try the next base (relative path 404s / CORS failures land here).
    }
  }
  return null;
}

// DE's chamber_files.json maps each state+chamber to its actual file name.
// Most are "<abbr>_<chamber>.json", but not all — MI and MN are
// "michigan_*"/"minnesota_*" — so guessing the name silently loses those
// states' targets, incumbents and past margins. Read the index instead.
async function ensureDeChamberIndex() {
  if (state.deChamberIndex) return state.deChamberIndex;
  const index = await fetchDeJson("chamber_files.json");
  const map = new Map();
  for (const chamber of ["house", "senate"]) {
    for (const entry of Array.isArray(index?.[chamber]) ? index[chamber] : []) {
      const abbr = normalizeStateAbbr(entry?.state || "");
      const url = String(entry?.url || "").trim();
      if (!abbr || !url) continue;
      map.set(`${abbr}|${chamber}`, url.replace(/^data\//, "")); // bases already end in data/
    }
  }
  state.deChamberIndex = map;
  return map;
}

async function ensureDeChamberData(abbr, chamber) {
  const stateAbbr = normalizeStateAbbr(abbr);
  if (!stateAbbr) return new Map();
  const key = `${stateAbbr}|${chamber}`;
  if (state.deDataByKey.has(key)) return state.deDataByKey.get(key);

  const index = await ensureDeChamberIndex();
  const fileName = index.get(key) || `${stateAbbr.toLowerCase()}_${chamber}.json`;
  const rows = await fetchDeJson(fileName);
  const map = new Map();
  for (const rec of Array.isArray(rows) ? rows : []) {
    const fips = normalizeStateFips(rec?.state_fips);
    const districtId = normalizeDistrictId(rec?.district_id);
    if (!fips || !districtId) continue;
    map.set(makeJoinKey(fips, districtId), rec);
  }
  state.deDataByKey.set(key, map);
  return map;
}

// ---------------------------------------------------------------------------
// Past-cycle ABEV (2022 / 2024)
//
// Same record shape as the current cycle, under data/abev/history/<year>/.
// Only states that have been backfilled appear; everything else renders "—".
// Loaded lazily per state+chamber, both years together, like the DE data above.
// ---------------------------------------------------------------------------

async function ensureHistoryIndex() {
  if (state.historyIndex) return state.historyIndex;
  const index = await fetchJson(ABEV_HISTORY_INDEX_URL);
  state.historyIndex = index && typeof index === "object" ? index : { years: {} };
  return state.historyIndex;
}

async function ensureHistoryData(abbr, chamber) {
  const stateAbbr = normalizeStateAbbr(abbr);
  if (!stateAbbr) return;
  const index = await ensureHistoryIndex();

  await Promise.all(HISTORY_YEARS.map(async (year) => {
    const key = `${year}|${stateAbbr}|${chamber}`;
    if (state.historyByKey.has(key)) return;

    const paths = index?.years?.[String(year)]?.[chamber];
    const wanted = `${stateAbbr.toLowerCase()}_${chamber}.json`;
    const path = (Array.isArray(paths) ? paths : []).find((p) => String(p).endsWith(wanted));

    const map = new Map();
    if (path) {
      const data = await fetchJson(String(path));
      const fips = normalizeStateFips(data?.state_fips);
      for (const rec of Array.isArray(data?.districts) ? data.districts : []) {
        const districtId = normalizeDistrictId(rec?.district_id);
        if (!fips || !districtId) continue;
        map.set(makeJoinKey(fips, districtId), rec);
      }
    }
    state.historyByKey.set(key, map); // cached even when empty, so we ask once
  }));

  await ensureHistoryTimelines();
}

// Statewide past-cycle timelines (one file per year, all states). The chrono
// tables run at state scope, where there is no district record to read from.
async function ensureHistoryTimelines() {
  if (state.historyTimelinesLoaded) return;
  const index = await ensureHistoryIndex();
  await Promise.all(HISTORY_YEARS.map(async (year) => {
    const byFips = new Map();
    const path = index?.years?.[String(year)]?.timeline;
    if (path) {
      const data = await fetchJson(String(path));
      for (const [fips, stats] of Object.entries(data?.states || {})) {
        const normalized = normalizeStateFips(fips);
        if (normalized) byFips.set(normalized, stats);
      }
    }
    state.historyTimelineByYear.set(year, byFips);
  }));
  state.historyTimelinesLoaded = true;
}

function historyRecordFor(year, joinKey, chamber = state.chamber) {
  const abbr = normalizeStateAbbr(state.selectedState?.abbr || "");
  return state.historyByKey.get(`${year}|${abbr}|${chamber}`)?.get(joinKey) || null;
}

// Does this state have any past-cycle data at all? Drives whether the
// Historical ABEV toggle is worth showing. District tables read the per-district
// files; the statewide chrono tables read the per-year timeline.
function historyAvailableForSelectedState() {
  const abbr = normalizeStateAbbr(state.selectedState?.abbr || "");
  if (!abbr) return false;
  const fips = normalizeStateFips(state.selectedState?.fips);
  return HISTORY_YEARS.some(
    (year) =>
      (state.historyByKey.get(`${year}|${abbr}|${state.chamber}`)?.size || 0) > 0 ||
      !!state.historyTimelineByYear.get(year)?.get(fips)
  );
}

// Does a past cycle line up with today's districts in this state? Where the
// state redrew its map in between (HISTORY_STALE_LINES) the counts are real but
// belong to different geography, so the columns render N/A instead and the
// trend graph doesn't offer the year at all.
function historyYearAppliesToSelectedState(year) {
  const abbr = normalizeStateAbbr(state.selectedState?.abbr || "");
  if (!abbr) return true;
  return !(HISTORY_STALE_LINES[year] || []).includes(abbr);
}

// Past-year timeline for whatever a chrono table is showing: a selected
// district, or the state as a whole when joinKey is null.
function historyTimelineForScope(year, joinKey) {
  if (joinKey) return historyRecordFor(year, joinKey)?.timeline || null;
  const fips = normalizeStateFips(state.selectedState?.fips);
  return state.historyTimelineByYear.get(year)?.get(fips) || null;
}

// How far the current cycle is from its election day. Past years are aligned to
// the same distance from *their* election day, so "99 days out" compares like
// with like. Clamped at 0 once election day has passed.
function daysOutFromElectionDay() {
  const days = daysBetweenIso(localTodayIso(), electionDayForSelectedState());
  return days > 0 ? days : 0;
}

function historyAsOfIso(year) {
  const electionDay = HISTORY_ELECTION_DAYS[year];
  if (!electionDay) return null;
  return addIsoDays(electionDay, -daysOutFromElectionDay());
}

// Running total for a past year as of its equivalent day.
//
// Undated rows (bad/unknown dates) are deliberately EXCLUDED here, unlike the
// cumulative chrono view's "Earlier" baseline. A vote whose date is unknown
// can't be placed in time, and treating it as pre-dating everything invents
// activity: VA's 2022 file has 29,353 undated votes but no real ABEV before
// Sept 19, so a baseline would report tens of thousands of votes cast 100 days
// out when the window had not even opened. Consequence: at 0 days out this runs
// slightly under Final Results, by exactly the undated count (~3% in VA).
function historyTotalsAsOf(rec, stat, asOfIso) {
  return historyTotalsInRange(rec?.timeline, stat, null, asOfIso);
}

// Sum a past-year timeline over a date window. `fromIso` null = from the start.
// Undated rows are always skipped (see above); `toIso` null takes everything.
function historyTotalsInRange(timeline, stat, fromIso, toIso) {
  const parts = stat === "voted" ? ["returned", "ev"] : [stat];
  const buckets = { rep: 0, dem: 0, toss: 0 };
  for (const part of parts) {
    for (const row of timeline?.[part] || []) {
      const key = String(row.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      if (fromIso && key < fromIso) continue;
      if (toIso && key > toIso) continue;
      buckets.rep += Number(row.rep || 0);
      buckets.dem += Number(row.dem || 0);
      buckets.toss += Number(row.toss || 0);
    }
  }
  const total = buckets.rep + buckets.dem + buckets.toss;
  return { ...buckets, total, net: buckets.rep - buckets.dem };
}

// The date in `year` that sits the same number of days from its election day as
// `iso` does from this cycle's — the per-row form of "On This Day".
function historyAlignedIso(year, iso) {
  const electionDay = HISTORY_ELECTION_DAYS[year];
  if (!electionDay || !iso) return null;
  return addIsoDays(electionDay, -daysBetweenIso(iso, electionDayForSelectedState()));
}

// Chrono tables have no Final Results option: a finished total is one number, so
// it would just repeat down every row. A Final picked in the district table
// falls back to On This Day there and is restored on the way back.
function historyModeFor({ chrono = false } = {}) {
  if (chrono && state.historyMode === "final") return "onthisday";
  return state.historyMode;
}

// Totals for a past year's column, honouring the On This Day / Final toggle.
function historyTotals(joinKey, year, stat) {
  const rec = historyRecordFor(year, joinKey);
  if (!rec) return null;
  if (state.historyMode === "final") return statTotals(rec, stat);
  const asOf = historyAsOfIso(year);
  if (!asOf) return null;
  return historyTotalsAsOf(rec, stat, asOf);
}

// Past-year totals for one chrono row: the row's own date span mapped to the
// same days-out in that year — the span itself in period mode, everything
// through its end in cumulative. The "Earlier"/"Unk" row has no date to align,
// so it gets nothing.
function chronoHistoryTotals(row, year, stat, { cumulative, joinKey }) {
  const timeline = historyTimelineForScope(year, joinKey);
  if (!timeline) return null;
  if (!row.startIso || !row.endIso) return null;
  const from = historyAlignedIso(year, row.startIso);
  const to = historyAlignedIso(year, row.endIso);
  if (!to) return null;
  return historyTotalsInRange(timeline, stat, cumulative ? null : from, to);
}

function deChamberMap(chamber = state.chamber) {
  const abbr = normalizeStateAbbr(state.selectedState?.abbr || "");
  return state.deDataByKey.get(`${abbr}|${chamber}`) || new Map();
}

function deRecordFor(joinKey) {
  return deChamberMap().get(joinKey) || null;
}

// District Explorer stores Dem-positive margins; this project is GOP-positive.
function legMarginRPositive(deRec, year) {
  const raw = deRec?.view_margins?.[`leg_${year}`];
  return typeof raw === "number" ? -raw : null;
}

function recordIsUpIn2026(deRec) {
  return Number(deRec?.next_election) === 2026;
}

// Incumbent party for the district: "R", "D", "S" (split multi-member), "O".
function incumbentPartyCode(deRec) {
  const members = Array.isArray(deRec?.members) ? deRec.members : [];
  if (members.length) {
    let hasRep = false;
    let hasDem = false;
    for (const member of members) {
      const party = String(member?.incumbent?.party || "").trim().toUpperCase();
      if (party === "R") hasRep = true;
      if (party === "D") hasDem = true;
    }
    if (hasRep && hasDem) return "S";
    if (hasRep) return "R";
    if (hasDem) return "D";
    return "O";
  }
  const party = String(deRec?.incumbent?.party || "").trim().toUpperCase();
  return party === "R" || party === "D" ? party : "O";
}

// GOP-held seats are what we defend; Dem-held are pickup opportunities.
function targetSectionForParty(party) {
  const normalized = String(party || "").trim().toUpperCase();
  if (normalized === "S") return "split";
  if (normalized === "R") return "defense";
  if (normalized === "D") return "offense";
  return null;
}

function districtTierValue(value) {
  const tier = Number(value);
  if (!Number.isInteger(tier) || tier < 1 || tier > 4) return null;
  return tier;
}

// --- Which past legislative elections to show as columns ---------------------

// The two most recent legislative elections that exist for this chamber, so
// odd-year states (VA: 2023/2025) work the same as even-year ones. Where a
// state's current lines postdate the older election, that column is still shown
// but explicitly unavailable, with a footnote explaining why.
function legMarginColumnsForChamber() {
  const map = deChamberMap();
  const years = new Set();
  for (const rec of map.values()) {
    for (const [key, value] of Object.entries(rec?.view_margins || {})) {
      const match = key.match(/^leg_(\d{4})$/);
      if (match && typeof value === "number") years.add(Number(match[1]));
    }
  }

  const sorted = [...years].sort((a, b) => a - b);
  const columns = sorted.slice(-2).map((year) => ({ year, available: true }));

  if (columns.length === 1) {
    const note = LEG_REDISTRICTING_NOTES[normalizeStateFips(state.selectedState?.fips)];
    // legColumn:false means the state held no legislative election that year at
    // all, so there is no margin column to stand in for.
    if (note && note.legColumn !== false && note.missingYear < columns[0].year) {
      columns.unshift({ year: note.missingYear, available: false });
    }
  }
  return columns;
}

// Shown whenever something on screen is N/A because of the redraw — an
// unavailable leg-margin column, or a past-cycle ABEV column for the same year.
function legRedistrictingNote() {
  const note = LEG_REDISTRICTING_NOTES[normalizeStateFips(state.selectedState?.fips)];
  if (!note) return "";
  if (legMarginColumnsForChamber().some((col) => !col.available)) return note.note;
  const showingHistory = historyModeFor() !== "none" && historyAvailableForSelectedState();
  return showingHistory && !historyYearAppliesToSelectedState(note.missingYear) ? note.note : "";
}

// `frame` adds the vline classes that bracket the column group, matching how
// columnVlineClass() frames the gap columns in the main table.
function legMarginCellsHtml(joinKey, columns, { frame = false } = {}) {
  const deRec = deRecordFor(joinKey);
  return columns
    .map((col, idx) => {
      let extra = " leg-margin-cell";
      if (frame) {
        if (idx === 0) extra += " abev-vline-left";
        // Right border on every leg column: the last one frames the group,
        // the others divide the leg years (e.g. 2022 | 2024).
        extra += " abev-vline-right";
      }
      if (!col.available) {
        return `<td class="margin-cell margin-cell-na${extra}" title="Districts redrawn after this election">N/A</td>`;
      }
      return marginCellHtml(legMarginRPositive(deRec, col.year), extra);
    })
    .join("");
}

function legMarginHeadCellsHtml(columns, { sortable = true, frame = false } = {}) {
  return columns
    .map((col, idx) => {
      const label = `${col.year}<br>Leg`;
      let extra = " leg-margin-head";
      if (frame) {
        if (idx === 0) extra += " abev-vline-left";
        // Right border on every leg column: the last one frames the group,
        // the others divide the leg years (e.g. 2022 | 2024).
        extra += " abev-vline-right";
      }
      if (!sortable) return `<th class="${extra.trim()}">${label}</th>`;
      return `<th class="abev-sortable${extra}" data-sort-scope="district" data-sort-key="leg_${col.year}">${label}${sortIndicator(state.districtSort, `leg_${col.year}`)}</th>`;
    })
    .join("");
}

// --- Target filter state -----------------------------------------------------

const TARGET_SECTIONS = ["split", "defense", "offense"];
const TARGET_TIERS = [1, 2, 3, 4];

function createDefaultTargetFilters() {
  const section = () => ({ enabled: true, tiers: { 1: true, 2: true, 3: true, 4: true } });
  return { split: section(), defense: section(), offense: section() };
}

function ensureTargetFilters() {
  if (!state.targetFilters) state.targetFilters = createDefaultTargetFilters();
  return state.targetFilters;
}

function resetTargetFilters() {
  state.targetFilters = createDefaultTargetFilters();
}

// Tiers that actually exist for a section in this chamber, so toggling a
// section on doesn't enable tiers that have no districts behind them.
function availableTargetTiersForSection(section) {
  const tiers = new Set();
  for (const rec of deChamberMap().values()) {
    if (targetSectionForParty(incumbentPartyCode(rec)) !== section) continue;
    const tier = districtTierValue(rec?.tier);
    if (tier !== null) tiers.add(tier);
  }
  return tiers.size ? [...tiers].sort((a, b) => a - b) : TARGET_TIERS;
}

function targetSectionHasAnyTierSelected(section) {
  ensureTargetFilters();
  return availableTargetTiersForSection(section).some((tier) => !!state.targetFilters[section]?.tiers?.[tier]);
}

function anyTargetFiltersActive() {
  return TARGET_SECTIONS.some(
    (section) => !!state.targetFilters?.[section]?.enabled && targetSectionHasAnyTierSelected(section)
  );
}

function targetSectionIsActive(section) {
  ensureTargetFilters();
  return !!state.targetDistrictsMode && !!state.targetFilters[section]?.enabled && targetSectionHasAnyTierSelected(section);
}

function targetTierIsActive(section, tier) {
  ensureTargetFilters();
  return !!state.targetDistrictsMode && !!state.targetFilters[section]?.enabled && !!state.targetFilters[section]?.tiers?.[tier];
}

function targetRecordPassesFilters(deRec) {
  const section = targetSectionForParty(incumbentPartyCode(deRec));
  const tier = districtTierValue(deRec?.tier);
  if (!section || tier === null) return false;
  ensureTargetFilters();
  return !!state.targetFilters[section]?.enabled && !!state.targetFilters[section]?.tiers?.[tier];
}

function setExclusiveTargetFilter(section, tier = null) {
  ensureTargetFilters();
  for (const key of TARGET_SECTIONS) {
    state.targetFilters[key].enabled = false;
    for (const t of TARGET_TIERS) state.targetFilters[key].tiers[t] = false;
  }
  if (!state.targetFilters[section]) return;
  state.targetFilters[section].enabled = true;
  if (tier === null) {
    for (const t of availableTargetTiersForSection(section)) state.targetFilters[section].tiers[t] = true;
  } else {
    state.targetFilters[section].tiers[tier] = true;
  }
}

// Clicking a section header or a tier cell. When targeting is off, the first
// click turns it on scoped to just what was clicked.
function toggleTargetFilterControl(section, tier = null) {
  ensureTargetFilters();
  if (!section || !state.targetFilters[section]) return;

  if (!state.targetDistrictsMode) {
    setExclusiveTargetFilter(section, tier);
    setTargetDistrictsMode(true, { preserveFilters: true, preserveScroll: true });
    return;
  }

  if (tier === null) {
    if (targetSectionIsActive(section)) {
      state.targetFilters[section].enabled = false;
    } else {
      state.targetFilters[section].enabled = true;
      for (const t of TARGET_TIERS) state.targetFilters[section].tiers[t] = false;
      for (const t of availableTargetTiersForSection(section)) state.targetFilters[section].tiers[t] = true;
    }
  } else if (!state.targetFilters[section].enabled || !state.targetFilters[section].tiers[tier]) {
    state.targetFilters[section].enabled = true;
    state.targetFilters[section].tiers[tier] = true;
  } else {
    state.targetFilters[section].tiers[tier] = false;
  }

  for (const key of TARGET_SECTIONS) {
    if (!targetSectionHasAnyTierSelected(key)) state.targetFilters[key].enabled = false;
  }

  if (!anyTargetFiltersActive()) {
    setTargetDistrictsMode(false, { preserveFilters: true, preserveScroll: true });
    return;
  }
  applyDistrictFilters({ preserveScroll: true });
}

// --- Filter application ------------------------------------------------------

function refreshFilteredDistrictJoinKeySet() {
  const map = deChamberMap();

  const targetSet = new Set();
  const upSet = new Set();
  for (const [joinKey, rec] of map.entries()) {
    if (districtTierValue(rec?.tier) !== null && targetRecordPassesFilters(rec)) targetSet.add(joinKey);
    if (recordIsUpIn2026(rec)) upSet.add(joinKey);
  }
  state.targetJoinKeySet = targetSet;
  state.upIn2026JoinKeySet = upSet;

  const activeSets = [];
  if (state.targetDistrictsMode) activeSets.push(targetSet);
  if (state.upIn2026Mode) activeSets.push(upSet);

  if (!activeSets.length) {
    state.filteredDistrictJoinKeySet = null;
    return;
  }

  // Intersection: a district must satisfy every active filter.
  const filtered = new Set(activeSets[0]);
  for (const set of activeSets.slice(1)) {
    for (const key of [...filtered]) {
      if (!set.has(key)) filtered.delete(key);
    }
  }
  state.filteredDistrictJoinKeySet = filtered;
}

// Map filtering: every active filter applies (target tiers AND up-in-2026).
function districtPassesActiveFilters(joinKey) {
  const set = state.filteredDistrictJoinKeySet;
  return !set || set.has(joinKey);
}

// Sidebar district table: only "Up in 2026" removes rows. Target-district
// selection is a map-only filter — the table keeps the full district list.
function districtPassesTableFilters(joinKey) {
  if (!state.upIn2026Mode) return true;
  return state.upIn2026JoinKeySet.has(joinKey);
}

// Recompute filters, then restyle the map and re-render the sidebar.
function applyDistrictFilters(options = {}) {
  refreshFilteredDistrictJoinKeySet();
  syncFilterToggleUi();
  refreshDistrictLayerForView();
  if (state.districtNumberLayer) {
    scheduleDistrictNumberLayerBuild(state.currentDistrictFeatures || []);
  }
  if (state.mode === "state" && !state.selectedDistrictLayer && !options.skipSidebar) {
    showActiveStateSidebar({ preserveScroll: options.preserveScroll });
  }
}

function setTargetDistrictsMode(enabled, options = {}) {
  state.targetDistrictsMode = !!enabled;
  ensureTargetFilters();
  if (state.targetDistrictsMode && !options.preserveFilters) resetTargetFilters();
  applyDistrictFilters({ preserveScroll: options.preserveScroll });
}

function setUpIn2026Mode(enabled) {
  state.upIn2026Mode = !!enabled;
  applyDistrictFilters();
}

function syncFilterToggleUi() {
  const inState = state.mode === "state";
  if (upIn2026Toggle) {
    upIn2026Toggle.checked = !!state.upIn2026Mode;
    upIn2026Toggle.disabled = !inState;
  }
  if (targetDistrictsToggle) {
    targetDistrictsToggle.checked = !!state.targetDistrictsMode;
    targetDistrictsToggle.disabled = !inState;
  }
}

// ---------------------------------------------------------------------------
// Sidebar: target districts section
// ---------------------------------------------------------------------------

const TARGET_SECTION_LABELS = { split: "Split", defense: "Defense", offense: "Offense" };

// Most recent legislative election available for this chamber (e.g. 2024 for
// WI, 2025 for VA) — used to rank target districts by competitiveness.
function latestAvailableLegYear() {
  const available = legMarginColumnsForChamber().filter((col) => col.available);
  return available.length ? available[available.length - 1].year : null;
}

function targetRowsForSelectedState() {
  const legYear = latestAvailableLegYear();
  const rows = [];
  for (const [joinKey, deRec] of deChamberMap().entries()) {
    const tier = districtTierValue(deRec?.tier);
    if (tier === null) continue;
    const incParty = incumbentPartyCode(deRec);
    const section = targetSectionForParty(incParty);
    if (!section) continue;
    const legMargin = legYear !== null ? legMarginRPositive(deRec, legYear) : null;
    rows.push({
      joinKey,
      tier,
      section,
      incParty,
      districtId: joinKey.split("|")[1] || "",
      label: displayDistrictId("", joinKey.split("|")[1] || ""),
      // Distance from even in the latest leg race; used for the in-tier sort.
      legCloseness: typeof legMargin === "number" ? Math.abs(legMargin) : Number.POSITIVE_INFINITY,
      rec: state.dataByChamber[state.chamber]?.get(joinKey) || null,
    });
  }
  // Within a tier, closest (most competitive) leg result first; ties by district.
  rows.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.legCloseness - b.legCloseness ||
      districtLabelSortValue(a.districtId) - districtLabelSortValue(b.districtId)
  );
  return rows;
}

function targetSectionTableHtml(sectionKey, rows, legCols) {
  const groups = TARGET_TIERS.map((tier) => ({ tier, rows: rows.filter((r) => r.tier === tier) })).filter(
    (g) => g.rows.length
  );
  if (!groups.length) {
    return '<div class="target-empty">None</div>';
  }

  // Same stat columns as the full district table, past cycles included, so the
  // two tables stay in sync as the Historical ABEV selector changes.
  const cols = viewColumnDefs(state.abevView, { withHistory: true });

  // Framed leg-margin group (gap + columns), mirroring the full district table.
  const legGroupCells = (joinKey) =>
    legCols.length ? `<td class="abev-gap-cell"></td>${legMarginCellsHtml(joinKey, legCols, { frame: true })}` : "";
  const legGroupHead = legCols.length
    ? `<th class="abev-gap-cell"></th>${legMarginHeadCellsHtml(legCols, { sortable: false, frame: true })}`
    : "";
  // Tier + Dist + Inc + [gap + legs] + view columns
  const colCount = 3 + (legCols.length ? legCols.length + 1 : 0) + cols.length;

  const body = groups
    .map((group, groupIdx) => {
      const groupActive = targetTierIsActive(sectionKey, group.tier);
      const groupRows = group.rows
        .map((row, rowIdx) => {
          const inactive = state.targetDistrictsMode && !targetTierIsActive(sectionKey, row.tier) ? " target-row-inactive" : "";
          const tierCell =
            rowIdx === 0
              ? `<td class="target-tier-group-cell target-filter-toggle${groupActive ? " active-target-mode" : ""}" data-target-section="${sectionKey}" data-target-tier="${group.tier}" rowspan="${group.rows.length}"><span class="target-tier-group-label">Tier ${group.tier}</span></td>`
              : "";
          return `
            <tr class="target-row district-select-row${inactive}${rowIdx === 0 ? " target-tier-group-start" : ""}" data-join-key="${escapeHtml(row.joinKey)}">
              ${tierCell}
              <td class="target-district-cell abev-vline-left">${escapeHtml(row.label)}</td>
              <td class="inc-cell inc-${row.incParty.toLowerCase()} abev-vline-right"><strong>${escapeHtml(row.incParty)}</strong></td>
              ${legGroupCells(row.joinKey)}
              ${viewColumnBodyCellsHtml(cols, row.rec, row.joinKey)}
            </tr>
          `;
        })
        .join("");
      const spacer =
        groupIdx < groups.length - 1
          ? `<tr class="target-tier-spacer" aria-hidden="true"><td colspan="${colCount}"></td></tr>`
          : "";
      return `${groupRows}${spacer}`;
    })
    .join("");

  return `
    <table class="abev-table abev-target-table">
      <thead>
        <tr>
          <th class="target-col-tier">Tier</th>
          <th class="target-col-district abev-vline-left">Dist</th>
          <th class="target-col-inc abev-vline-right">Inc</th>
          ${legGroupHead}
          ${viewColumnHeadCellsHtml(cols, { sortable: false })}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function targetDistrictsSectionHtml() {
  const allRows = targetRowsForSelectedState();
  if (!allRows.length) return "";
  const legCols = legMarginColumnsForChamber();

  const columns = TARGET_SECTIONS.map((section) => {
    const rows = allRows.filter((r) => r.section === section);
    if (!rows.length) return "";
    const active = targetSectionIsActive(section);
    // Only dim sections while targeting is actually on — with it off, nothing
    // is "active" and the whole section would otherwise render washed out.
    const muted = state.targetDistrictsMode && !active;
    return `
      <div class="target-column${muted ? " target-column-muted" : ""}">
        <div class="detail-subtitle centered-subtitle chart-header target-section-toggle target-filter-toggle${active ? " active-target-mode" : ""}" data-target-section="${section}">${TARGET_SECTION_LABELS[section]}</div>
        ${targetSectionTableHtml(section, rows, legCols)}
      </div>
    `;
  }).join("");

  const note = legRedistrictingNote();
  return `
    <div id="targetModeHeader" class="detail-section-title centered-section-title large-section-title target-mode-header${state.targetDistrictsMode ? " active-target-mode" : ""}">Target Districts</div>
    <div class="target-columns">${columns}</div>
    ${note ? `<div class="leg-redistricting-note">${escapeHtml(note)}</div>` : ""}
    <div class="detail-break"></div>
  `;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function wireEvents() {
  houseChamberBtn.addEventListener("click", async () => {
    await setChamber("house");
  });

  senateChamberBtn.addEventListener("click", async () => {
    await setChamber("senate");
  });

  if (upIn2026Toggle) {
    upIn2026Toggle.addEventListener("change", (e) => {
      setUpIn2026Mode(!!e.target.checked);
    });
  }

  if (targetDistrictsToggle) {
    targetDistrictsToggle.addEventListener("change", (e) => {
      setTargetDistrictsMode(!!e.target.checked);
    });
  }

  stateSelect.addEventListener("change", async (e) => {
    const key = String(e.target.value || "").trim();
    if (!key) return;
    await selectStateByKey(key);
  });

  exitStateBtn.addEventListener("click", () => {
    enterNationalView();
  });

  document.addEventListener("keydown", async (e) => {
    if (isEditableTarget(e.target)) return;
    if (e.key === "Control") {
      applyFineZoomMode(true);
    }

    if (/^[1-3]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (idx < ABEV_VIEWS.length) {
        e.preventDefault();
        setAbevView(ABEV_VIEWS[idx]);
      }
      return;
    }

    if (state.mode !== "state") return;

    if (e.key === "Escape") {
      if (state.hasOpenPopup) {
        map.closePopup();
        return;
      }
      if (state.selectedDistrictLayer) {
        clearSelectedDistrict();
        showActiveStateSidebar();
        return;
      }
      if (state.chronoMode) {
        setChronoMode(null);
        return;
      }
      enterNationalView();
      return;
    }

    if (e.key === "Shift" && e.location === 1 && !e.repeat) {
      const nextChamber = state.chamber === "house" ? "senate" : "house";
      await setChamber(nextChamber);
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.key === "Control") {
      applyFineZoomMode(false);
    }
  });

  window.addEventListener("blur", () => {
    applyFineZoomMode(false);
  });

  map.getContainer().addEventListener(
    "wheel",
    (e) => {
      // Apply before Leaflet's wheel handler runs so ctrl+wheel uses finer zoom increments.
      applyFineZoomMode(e.ctrlKey);
      if (e.ctrlKey) {
        e.preventDefault();
      }
    },
    { capture: true, passive: false }
  );

  map.on("zoomend", () => {
    refreshDistrictNumberLabels();
  });

  map.on("popupopen", () => {
    state.hasOpenPopup = true;
  });

  map.on("popupclose", () => {
    state.hasOpenPopup = false;
    if (state.suspendPopupCloseOverview) return;
    clearSelectedDistrict();
    if (state.mode === "state") {
      showActiveStateSidebar();
    }
  });
}

function showActiveStateSidebar(options = {}) {
  const passthrough = { preserveScroll: options.preserveScroll };
  if (state.chronoMode) {
    showChronoView(passthrough);
  } else {
    showStateChamberOverview(passthrough);
  }
  updateTrendChartUi();
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.closest("[contenteditable='true']") !== null;
}

function applyFineZoomMode(enabled) {
  if (enabled) {
    map.options.wheelPxPerZoomLevel = BASE_WHEEL_PX_PER_ZOOM_LEVEL * CTRL_WHEEL_ZOOM_SLOW_FACTOR;
    map.options.zoomSnap = CTRL_FINE_ZOOM_SNAP;
    map.options.zoomDelta = CTRL_FINE_ZOOM_SNAP;
    return;
  }
  map.options.wheelPxPerZoomLevel = BASE_WHEEL_PX_PER_ZOOM_LEVEL;
  map.options.zoomSnap = BASE_ZOOM_SNAP;
  map.options.zoomDelta = BASE_ZOOM_SNAP;
}

// ---------------------------------------------------------------------------
// ABEV view buttons (Absentees / Early Votes / ABEV Total)
// ---------------------------------------------------------------------------

function renderViewButtons() {
  if (!statViewButtons) return;
  statViewButtons.innerHTML = "";
  for (const view of ABEV_VIEWS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.view = view;
    button.textContent = VIEW_BUTTON_LABELS[view] || view;
    button.title = `${VIEW_CARD_LABELS[view] || view} (key ${ABEV_VIEWS.indexOf(view) + 1})`;
    button.addEventListener("click", () => {
      setAbevView(view);
    });
    statViewButtons.appendChild(button);
  }
  syncViewButtons();
}

function syncViewButtons() {
  if (!statViewButtons) return;
  for (const button of statViewButtons.querySelectorAll("button")) {
    button.classList.toggle("active-stat", button.dataset.view === state.abevView);
  }
}

function setAbevView(view) {
  if (!ABEV_VIEWS.includes(view) || state.abevView === view) return;
  state.abevView = view;
  syncViewButtons();
  refreshStateBoundaryStyles();
  refreshDistrictLayerForView();
  updateTrendChartUi();

  if (state.mode === "national") {
    renderNationalOverview();
    return;
  }
  if (state.chronoMode) {
    showChronoView();
    return;
  }
  if (state.selectedDistrictLayer) {
    const layer = state.selectedDistrictLayer;
    const feature = layer.__featureRef;
    if (feature) {
      const joinInfo = extractJoinIds(feature.properties);
      showDistrictDetailPanel(feature.properties, joinInfo, layer.__dataMapRef?.get(joinInfo.key));
      return;
    }
  }
  showStateChamberOverview();
}

function refreshDistrictLayerForView() {
  if (!state.districtLayer) return;
  state.districtLayer.eachLayer((layer) => {
    if (state.selectedDistrictLayer && state.selectedDistrictLayer === layer) {
      layer.setStyle(districtSelectedStyle(layer.__featureRef, layer.__dataMapRef));
    } else {
      resetDistrictStyle(layer);
    }
  });
}

// ---------------------------------------------------------------------------
// State layer (national map)
// ---------------------------------------------------------------------------

async function autoLoadStateShapes() {
  setStatus("Loading state boundaries...");
  const statesGeojson = await loadUrlZipToGeojson(AUTO_SHAPE_URLS.states);
  if (!statesGeojson) {
    setStatus("Missing data/shapes/states.zip.");
    return;
  }

  const filtered = {
    type: "FeatureCollection",
    features: (statesGeojson.features || []).filter((feature) => {
      const meta = stateMetaFromFeature(feature);
      return !isDistrictOfColumbia(meta) && !isOverseasTerritory(meta);
    }),
  };

  state.statesGeojson = filtered;
  buildStateLayer(filtered);
  populateStateSelect(filtered);
  setStatus("State boundaries loaded. Select a state to view districts.");
}

function buildStateLayer(geojson) {
  if (state.statesLayer && map.hasLayer(state.statesLayer)) {
    map.removeLayer(state.statesLayer);
  }
  state.stateBoundsByKey = new Map();
  state.stateLayerByKey = new Map();

  state.statesLayer = L.geoJSON(geojson, {
    pane: "statePane",
    style: (feature) => stateBoundaryStyle(feature),
    onEachFeature: (feature, layer) => {
      const meta = stateMetaFromFeature(feature);
      if (!meta.key) return;
      layer.__featureRef = feature;
      state.stateLayerByKey.set(meta.key, layer);
      const bounds = layer.getBounds();
      if (bounds?.isValid?.()) {
        state.stateBoundsByKey.set(meta.key, bounds);
      }

      layer.on("mouseover", (e) => {
        setHoveredStateKey(meta.key);
        if (state.mode === "national") {
          const rec = state.nationalByFips.get(normalizeStateFips(meta.fips));
          showDistrictHoverInfo(e.containerPoint, stateHoverHtml(meta, rec));
        }
      });
      layer.on("mousemove", (e) => {
        moveDistrictHoverInfo(e.containerPoint);
      });
      layer.on("mouseout", () => {
        if (state.hoveredStateKey === meta.key) {
          setHoveredStateKey(null);
        }
        hideDistrictHoverInfo();
      });
      layer.on("click", async () => {
        hideDistrictHoverInfo();
        await selectStateByMeta(meta, feature, { shouldZoom: true, bounds });
      });
    },
  });

  if (!map.hasLayer(state.statesLayer)) {
    map.addLayer(state.statesLayer);
  }
}

function populateStateSelect(geojson) {
  const items = [];
  const seen = new Set();
  state.statesByKey = new Map();
  for (const feature of geojson.features || []) {
    const meta = stateMetaFromFeature(feature);
    if (!meta.key || seen.has(meta.key)) continue;
    seen.add(meta.key);
    items.push(meta);
    state.statesByKey.set(meta.key, { meta, feature });
  }

  items.sort((a, b) => String(a.name || a.abbr || a.key).localeCompare(String(b.name || b.abbr || b.key)));

  stateSelect.innerHTML = '<option value="">Select State...</option>';
  for (const meta of items) {
    const option = document.createElement("option");
    option.value = meta.key;
    const parts = [meta.name || meta.abbr || meta.fips || meta.key];
    if (meta.abbr && meta.name && meta.abbr !== meta.name) parts.push(`(${meta.abbr})`);
    option.textContent = parts.join(" ");
    stateSelect.appendChild(option);
  }
}

function stateMetaFromFeature(feature) {
  const properties = feature?.properties || {};
  const fips = stateFipsFromProperties(properties);
  const abbr = normalizeStateAbbr(readProperty(properties, "STUSPS") || readProperty(properties, "USPS") || readProperty(properties, "STATE_ABBR"));
  const name = String(readProperty(properties, "NAME") || readProperty(properties, "STATE_NAME") || readProperty(properties, "NAMELSAD") || "").trim();
  const key = fips || abbr || normalizeTextKey(name);
  return { key, fips, abbr, name };
}

function isDistrictOfColumbia(meta) {
  if (!meta) return false;
  const name = String(meta.name || "").trim().toUpperCase();
  return meta.fips === "11" || meta.abbr === "DC" || name === "DISTRICT OF COLUMBIA";
}

function isOverseasTerritory(meta) {
  if (!meta) return false;
  const fips = normalizeStateFips(meta.fips);
  const abbr = normalizeStateAbbr(meta.abbr);
  return OVERSEAS_TERRITORY_FIPS.has(fips) || OVERSEAS_TERRITORY_ABBR.has(abbr);
}

function normalizeTextKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeStateAbbr(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
}

function stateFipsFromProperties(properties = {}) {
  return normalizeStateFips(
    readProperty(properties, "STATEFP")
      || readProperty(properties, "STATE_FIPS")
      || readProperty(properties, "GEOID")
      || readProperty(properties, "FIPS")
      || readProperty(properties, "STATE")
  );
}

function refreshStateBoundaryStyles() {
  if (state.statesLayer) {
    state.statesLayer.setStyle((feature) => stateBoundaryStyle(feature));
    renderHoveredStateOverlay();
  }
}

function stateBoundaryStyle(feature) {
  const meta = stateMetaFromFeature(feature);
  const isSelected = state.mode === "state" && state.selectedState && meta.key === state.selectedState.key;
  if (isSelected) {
    return {
      color: "#2f3c4b",
      weight: 0,
      fillColor: "#b9c6d3",
      fillOpacity: 0,
      opacity: 0,
    };
  }

  if (state.mode === "national") {
    const rec = state.nationalByFips.get(normalizeStateFips(meta.fips));
    const netPct = rec ? netPctForRecord(rec, mapStat()) : null;
    return {
      color: "#1b2733",
      weight: 1.5,
      opacity: 1,
      fillColor: netColor(netPct),
      fillOpacity: typeof netPct === "number" ? 0.72 : 0.12,
    };
  }

  return {
    color: "#2f3c4b",
    weight: 1.5,
    opacity: 1,
    fillColor: "#b9c6d3",
    fillOpacity: 0.08,
  };
}

function stateHoverBoundaryStyle(feature) {
  const base = stateBoundaryStyle(feature);
  return {
    ...base,
    color: "#9cb2c7",
    weight: Math.max(3.2, Number(base.weight || 0)),
    opacity: 1,
    fillOpacity: Math.max(0.14, Number(base.fillOpacity || 0)),
  };
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------

async function selectStateByKey(key) {
  if (!state.statesGeojson) return;
  const target = String(key || "").trim();
  if (!target) return;

  const entry = state.statesByKey.get(target);
  if (!entry) return;
  await selectStateByMeta(entry.meta, entry.feature, { shouldZoom: true, bounds: state.stateBoundsByKey.get(target) || null });
}

async function selectStateByMeta(meta, feature, options = {}) {
  const { shouldZoom = state.mode === "national", bounds = null } = options;
  state.mode = "state";
  state.selectedState = meta;
  state.districtSort = { key: null, direction: 0 };
  setHoveredStateRow(null);
  setHoveredStateKey(null);
  clearStateHoverOutline();
  hideDistrictHoverInfo();
  stateSelect.value = meta.key;
  detailsTitle.textContent = selectedStateChamberHeader();

  if (state.statesLayer && !map.hasLayer(state.statesLayer)) {
    map.addLayer(state.statesLayer);
  }

  const featureBounds = bounds && bounds.isValid && bounds.isValid() ? bounds : geometryBounds(feature?.geometry);
  if (shouldZoom) {
    focusOnState(meta, featureBounds);
  }

  await Promise.all([
    ensureDistrictShapesLoaded(),
    ensureDeChamberData(meta.abbr, state.chamber),
    ensureHistoryData(meta.abbr, state.chamber),
  ]);
  refreshFilteredDistrictJoinKeySet();
  renderDistrictLayerForSelectedState();
  refreshStateBoundaryStyles();
  renderModeUi();
  setStatus(`Viewing ${meta.name || meta.abbr || meta.key} ${chamberLabel(state.chamber)} districts.`);
}

function focusOnState(meta, bounds) {
  const abbr = normalizeStateAbbr(meta?.abbr || "");
  if (abbr === "AK") {
    map.setView([64.8, -150.0], 4, { animate: false });
    return;
  }
  if (bounds && bounds.isValid && bounds.isValid()) {
    map.fitBounds(bounds.pad(0.1), { animate: false });
  }
}

function enterNationalView() {
  state.mode = "national";
  state.selectedState = null;
  stateSelect.value = "";
  state.filteredDistrictJoinKeySet = null;
  clearDistrictLayer();
  if (state.statesLayer && !map.hasLayer(state.statesLayer)) {
    map.addLayer(state.statesLayer);
  }
  refreshStateBoundaryStyles();

  map.setView(NATIONAL_CENTER, NATIONAL_ZOOM);
  renderNationalOverview();
  renderModeUi();
  setStatus("National overview. Select a state to view districts.");
}

function renderNationalOverview() {
  hideSchedTooltip();
  state.detailsRenderToken += 1;
  const renderToken = state.detailsRenderToken;
  detailsTitle.textContent = "National Overview";
  setDetailsLoading("Loading national overview table...");
  resetSidebarScroll();
  requestAnimationFrame(() => {
    if (state.mode !== "national" || renderToken !== state.detailsRenderToken) return;
    details.innerHTML = nationalOverviewHtml();
    wireDetailsInteractions();
    resetSidebarScroll();
  });
}

function renderModeUi() {
  const inState = state.mode === "state";
  houseChamberBtn.disabled = !inState;
  senateChamberBtn.disabled = !inState;
  exitStateBtn.hidden = !inState;
  houseChamberBtn.classList.toggle("active-chamber", inState && state.chamber === "house");
  senateChamberBtn.classList.toggle("active-chamber", inState && state.chamber === "senate");
  syncFilterToggleUi();
  updateTrendChartUi();
}

async function setChamber(chamber) {
  if (chamber !== "house" && chamber !== "senate") return;
  const exitingChrono = !!state.chronoMode;
  if (state.chamber === chamber && !exitingChrono) return;
  state.chronoMode = null;
  state.chamber = chamber;
  state.districtSort = { key: null, direction: 0 };
  renderModeUi();
  if (state.mode === "state") {
    await Promise.all([
      ensureDistrictShapesLoaded(),
      ensureDeChamberData(state.selectedState?.abbr, chamber),
      ensureHistoryData(state.selectedState?.abbr, chamber),
    ]);
    refreshFilteredDistrictJoinKeySet();
    renderDistrictLayerForSelectedState();
    refreshStateBoundaryStyles();
  }
}

function setChronoMode(mode) {
  if (mode !== null && !CHRONO_MODE_LABELS[mode]) return;
  if (state.mode !== "state" || state.chronoMode === mode) return;
  state.chronoMode = mode;
  clearSelectedDistrict();
  map.closePopup();
  renderModeUi();
  showActiveStateSidebar();
}

function chamberLabel(chamber) {
  return chamber === "house" ? "Lower Chamber" : "Upper Chamber";
}

// Proper chamber name from District Explorer's state_chamber_names.json,
// e.g. "VA|house" -> "VA House of Delegates" -> "Virginia House of Delegates".
function chamberDisplayName(meta = state.selectedState, chamber = state.chamber) {
  const abbr = normalizeStateAbbr(meta?.abbr || "");
  const stateName = meta?.name || abbr || "State";
  const raw = state.chamberNamesByState.get(`${abbr}|${chamber}`) || "";
  if (raw) {
    if (abbr && raw.toUpperCase().startsWith(`${abbr} `)) {
      return `${stateName} ${raw.slice(abbr.length + 1)}`;
    }
    return raw;
  }
  return `${stateName} — ${chamberLabel(chamber)}`;
}

// ---------------------------------------------------------------------------
// District shapes
// ---------------------------------------------------------------------------

async function ensureDistrictShapesLoaded() {
  const chamber = state.chamber;
  if (state.geojsonByChamber[chamber]) return;
  setStatus("Loading district shapefiles...");
  state.geojsonByChamber[chamber] = await loadUrlZipToGeojson(AUTO_SHAPE_URLS[chamber]);
  if (state.geojsonByChamber[chamber]) {
    indexDistrictFeaturesByState(chamber, state.geojsonByChamber[chamber]);
  }

  // Preload the other chamber in the background to reduce wait on chamber switch.
  const other = chamber === "house" ? "senate" : "house";
  if (!state.geojsonByChamber[other]) {
    loadUrlZipToGeojson(AUTO_SHAPE_URLS[other]).then((geojson) => {
      if (!state.geojsonByChamber[other]) {
        state.geojsonByChamber[other] = geojson;
        if (geojson) indexDistrictFeaturesByState(other, geojson);
      }
    });
  }
}

function indexDistrictFeaturesByState(chamber, geojson) {
  const filteredFeatures = (geojson?.features || []).filter((feature) => !isPlaceholderDistrictFeature(feature, chamber));
  state.districtFeaturesByChamberState[chamber] = indexFeaturesByStateFips(filteredFeatures);
}

function isPlaceholderDistrictFeature(feature, chamber = state.chamber) {
  const props = feature?.properties || {};
  const districtField = chamber === "house" ? "SLDLST" : "SLDUST";
  const rawDistrict = String(readProperty(props, districtField) || "").trim().toUpperCase();
  // TIGER legislative shapefiles include non-district placeholders like ZZZ.
  return rawDistrict === "ZZZ";
}

function indexFeaturesByStateFips(features) {
  const byState = new Map();
  for (const feature of features || []) {
    const props = feature?.properties || {};
    const stateFips = normalizeStateFips(readProperty(props, "STATEFP") || readProperty(props, "STATE_FIPS"));
    if (!stateFips) continue;
    if (!byState.has(stateFips)) byState.set(stateFips, []);
    byState.get(stateFips).push(feature);
  }
  return byState;
}

function districtFeaturesForSelectedState(chamber = state.chamber) {
  if (!state.selectedState) return [];
  const stateFips = normalizeStateFips(state.selectedState.fips);
  const index = state.districtFeaturesByChamberState[chamber];
  if (stateFips && index?.has(stateFips)) return index.get(stateFips);

  // Fallback path when index is unavailable.
  const geojson = state.geojsonByChamber[chamber];
  if (!geojson) return [];
  return (geojson.features || []).filter(
    (feature) => featureMatchesSelectedState(feature.properties) && !isPlaceholderDistrictFeature(feature, chamber)
  );
}

function featureMatchesSelectedState(properties = {}) {
  if (!state.selectedState) return false;

  const featureFips = normalizeStateFips(readProperty(properties, "STATEFP") || readProperty(properties, "STATE_FIPS"));
  const featureAbbr = normalizeStateAbbr(readProperty(properties, "STUSPS") || readProperty(properties, "USPS") || readProperty(properties, "STATE_ABBR"));
  const featureName = normalizeTextKey(readProperty(properties, "NAME") || readProperty(properties, "STATE_NAME") || readProperty(properties, "STATENAME"));

  if (state.selectedState.fips && featureFips) return featureFips === state.selectedState.fips;
  if (state.selectedState.abbr && featureAbbr) return featureAbbr === state.selectedState.abbr;
  if (state.selectedState.name && featureName) return featureName === normalizeTextKey(state.selectedState.name);
  return false;
}

function renderDistrictLayerForSelectedState() {
  clearDistrictLayer();
  if (!state.selectedState) return;

  const selectedAbbr = normalizeStateAbbr(state.selectedState?.abbr || "");
  if (state.chamber === "house" && selectedAbbr === "NE") {
    if (state.chronoMode) {
      showChronoView();
      return;
    }
    state.detailsRenderToken += 1;
    detailsTitle.textContent = selectedStateChamberHeader();
    details.innerHTML = `
      ${statewideCardsHtml()}
      ${stateChronoButtonsHtml()}
      <div class="detail-break"></div>
      Switch to Upper Chamber to view Nebraska's unicameral legislature.
    `;
    wireDetailsInteractions();
    resetSidebarScroll();
    return;
  }

  const geojson = state.geojsonByChamber[state.chamber];
  if (!geojson) {
    state.detailsRenderToken += 1;
    details.innerHTML = "District shapefile missing for this chamber.";
    resetSidebarScroll();
    return;
  }

  const dataMap = state.dataByChamber[state.chamber];
  const selectedFeatures = districtFeaturesForSelectedState(state.chamber);
  if (!selectedFeatures.length) {
    state.detailsRenderToken += 1;
    details.innerHTML = "No districts found for selected state/chamber.";
    resetSidebarScroll();
    return;
  }
  state.currentDistrictFeatures = selectedFeatures;

  state.districtLayer = L.geoJSON(
    {
      type: "FeatureCollection",
      features: selectedFeatures,
    },
    {
      pane: "districtPane",
      style: (feature) => districtBaseStyle(feature, dataMap),
      onEachFeature: (feature, layer) => {
        const joinInfo = extractJoinIds(feature.properties);
        const rec = dataMap.get(joinInfo.key);
        layer.__featureRef = feature;
        layer.__dataMapRef = dataMap;
        layer.__joinKey = joinInfo.key;
        state.districtLayerIndex.set(joinInfo.key, layer);
        layer.bindPopup(() => popupHtml(feature.properties, joinInfo, dataMap.get(joinInfo.key)));
        layer.on("mouseover", (e) => {
          showDistrictHoverOutline(feature);
          showDistrictHoverInfo(e.containerPoint, popupHtml(feature.properties, joinInfo, dataMap.get(joinInfo.key)));
        });
        layer.on("mousemove", (e) => {
          moveDistrictHoverInfo(e.containerPoint);
        });
        layer.on("mouseout", () => {
          clearDistrictHoverOutline();
          hideDistrictHoverInfo();
        });
        layer.on("click", () => {
          clearDistrictHoverOutline();
          hideDistrictHoverInfo();
          setSelectedDistrict(layer);
          showDistrictDetailPanel(feature.properties, joinInfo, dataMap.get(joinInfo.key));
        });
      },
    }
  ).addTo(map);

  scheduleDistrictNumberLayerBuild(selectedFeatures);
  showActiveStateSidebar();
}

function clearDistrictLayer() {
  state.suspendPopupCloseOverview = true;
  map.closePopup();
  setTimeout(() => {
    state.suspendPopupCloseOverview = false;
  }, 0);
  state.districtLayerIndex = new Map();
  state.currentDistrictFeatures = [];
  state.districtNumberBuildToken += 1;
  state.hoveredTableRowEl = null;
  setHoveredStateRow(null);
  setHoveredStateKey(null);
  clearStateHoverOutline();
  if (state.districtLayer) {
    map.removeLayer(state.districtLayer);
    state.districtLayer = null;
  }
  clearDistrictNumberLayer();
  state.selectedDistrictLayer = null;
  hideChamberOverviewButton();
  clearDistrictHoverOutline();
  clearSelectedDistrictOutline();
  hideDistrictHoverInfo();
}

// ---------------------------------------------------------------------------
// District styles & selection
// ---------------------------------------------------------------------------

function colorForFeature(feature, dataMap) {
  const rec = dataMap.get(extractJoinIds(feature.properties).key);
  if (!rec) return "#d5dae0";
  return netColor(netPctForRecord(rec, mapStat()));
}

function districtBaseStyle(feature, dataMap) {
  // Districts excluded by the active filters stay on the map but recede.
  if (!districtPassesActiveFilters(extractJoinIds(feature.properties).key)) {
    return {
      weight: 1.2,
      color: "#2f3c4b",
      opacity: 0.85,
      fillOpacity: 0.08,
      fillColor: "#b9c6d3",
    };
  }
  return {
    weight: 1.4,
    color: "#1b2733",
    fillOpacity: 0.7,
    fillColor: colorForFeature(feature, dataMap),
  };
}

function districtHoverStyle(feature, dataMap) {
  return {
    ...districtBaseStyle(feature, dataMap),
    weight: 3.8,
    color: "#ffffff",
  };
}

function districtSelectedStyle(feature, dataMap) {
  return {
    ...districtBaseStyle(feature, dataMap),
    weight: 3.2,
    color: "#ffffff",
  };
}

function setSelectedDistrict(layer) {
  if (!layer) return;
  if (state.selectedDistrictLayer && state.selectedDistrictLayer !== layer) {
    resetDistrictStyle(state.selectedDistrictLayer);
  }

  state.selectedDistrictLayer = layer;
  const feature = layer.__featureRef;
  const dataMap = layer.__dataMapRef;
  layer.setStyle(districtSelectedStyle(feature, dataMap));
  layer.bringToFront();
  showSelectedDistrictOutline(feature);
  showChamberOverviewButton();
}

function resetDistrictStyle(layer) {
  if (!layer) return;
  const feature = layer.__featureRef;
  const dataMap = layer.__dataMapRef;
  if (!feature || !dataMap) return;
  layer.setStyle(districtBaseStyle(feature, dataMap));
}

function clearSelectedDistrict() {
  if (state.selectedDistrictLayer) {
    resetDistrictStyle(state.selectedDistrictLayer);
    state.selectedDistrictLayer = null;
  }
  clearSelectedDistrictOutline();
  hideChamberOverviewButton();
}

function showSelectedDistrictOutline(feature) {
  clearSelectedDistrictOutline();
  if (!feature) return;

  state.selectedDistrictOutlineLayer = L.geoJSON(feature, {
    pane: "districtHoverPane",
    interactive: false,
    style: {
      color: "#ffffff",
      weight: 4.6,
      opacity: 1,
      fillOpacity: 0,
    },
  }).addTo(map);
}

function clearSelectedDistrictOutline() {
  if (!state.selectedDistrictOutlineLayer) return;
  if (map.hasLayer(state.selectedDistrictOutlineLayer)) map.removeLayer(state.selectedDistrictOutlineLayer);
  state.selectedDistrictOutlineLayer = null;
}

function showDistrictHoverOutline(feature) {
  clearDistrictHoverOutline();
  if (!feature) return;

  state.hoverDistrictLayer = L.geoJSON(feature, {
    pane: "districtHoverPane",
    interactive: false,
    style: {
      color: "#ffffff",
      weight: 4.2,
      opacity: 1,
      fillOpacity: 0,
    },
  }).addTo(map);
}

function clearDistrictHoverOutline() {
  if (!state.hoverDistrictLayer) return;
  if (map.hasLayer(state.hoverDistrictLayer)) map.removeLayer(state.hoverDistrictLayer);
  state.hoverDistrictLayer = null;
}

// ---------------------------------------------------------------------------
// Hover info + chamber overview button
// ---------------------------------------------------------------------------

function initHoverInfo() {
  const container = map.getContainer();
  const el = document.createElement("div");
  el.className = "district-hover-info";
  el.style.display = "none";
  container.appendChild(el);
  state.hoverInfoEl = el;
}

function initChamberOverviewButton() {
  const container = map.getContainer();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-overview-button";
  button.textContent = "Chamber Overview";
  button.setAttribute("aria-label", "Return to chamber overview");
  button.addEventListener("click", () => {
    if (state.hasOpenPopup) {
      map.closePopup();
      return;
    }
    clearSelectedDistrict();
    if (state.mode === "state") {
      showActiveStateSidebar();
    }
  });
  container.appendChild(button);
  state.chamberOverviewBtnEl = button;
}

function showChamberOverviewButton() {
  if (!state.chamberOverviewBtnEl) return;
  state.chamberOverviewBtnEl.classList.add("visible");
}

function hideChamberOverviewButton() {
  if (!state.chamberOverviewBtnEl) return;
  state.chamberOverviewBtnEl.classList.remove("visible");
}

function showDistrictHoverInfo(containerPoint, html) {
  if (!state.hoverInfoEl) return;
  state.hoverInfoEl.innerHTML = html;
  state.hoverInfoEl.style.display = "block";
  moveDistrictHoverInfo(containerPoint);
}

function moveDistrictHoverInfo(containerPoint) {
  if (!state.hoverInfoEl || state.hoverInfoEl.style.display === "none" || !containerPoint) return;
  const offsetX = -14;
  const offsetY = 14;
  state.hoverInfoEl.style.left = `${containerPoint.x + offsetX}px`;
  state.hoverInfoEl.style.top = `${containerPoint.y + offsetY}px`;
  state.hoverInfoEl.style.transform = "translate(-100%, 0)";
}

function hideDistrictHoverInfo() {
  if (!state.hoverInfoEl) return;
  state.hoverInfoEl.style.display = "none";
}

// ---------------------------------------------------------------------------
// Hover state (map <-> table)
// ---------------------------------------------------------------------------

function setHoveredTableRow(row) {
  if (state.hoveredTableRowEl && state.hoveredTableRowEl !== row) {
    state.hoveredTableRowEl.classList.remove("is-hovered");
  }
  state.hoveredTableRowEl = row || null;
  if (!row) {
    clearDistrictHoverOutline();
    return;
  }
  row.classList.add("is-hovered");
  const layer = districtLayerForJoinKey(row.dataset.joinKey || "");
  if (!layer?.__featureRef) return;
  showDistrictHoverOutline(layer.__featureRef);
}

function setHoveredStateKey(key) {
  const nextKey = key ? String(key) : null;
  if (state.hoveredStateKey === nextKey) return;
  state.hoveredStateKey = nextKey;
  renderHoveredStateOverlay();
}

function renderHoveredStateOverlay() {
  clearStateHoverOutline();
  if (!state.hoveredStateKey) return;
  const nextLayer = state.stateLayerByKey.get(state.hoveredStateKey);
  if (!nextLayer) return;
  const feature = nextLayer.__featureRef || nextLayer.feature;
  state.hoveredStateOverlayLayer = L.geoJSON(feature, {
    pane: "stateHoverPane",
    interactive: false,
    style: stateHoverBoundaryStyle(feature),
  }).addTo(map);
}

function clearStateHoverOutline() {
  if (!state.hoveredStateOverlayLayer) return;
  if (map.hasLayer(state.hoveredStateOverlayLayer)) map.removeLayer(state.hoveredStateOverlayLayer);
  state.hoveredStateOverlayLayer = null;
}

function setHoveredStateRow(row) {
  if (state.hoveredStateRowEl && state.hoveredStateRowEl !== row) {
    state.hoveredStateRowEl.classList.remove("is-hovered");
  }

  state.hoveredStateRowEl = row || null;
  const key = row?.dataset?.stateKey ? String(row.dataset.stateKey) : null;

  if (row) {
    row.classList.add("is-hovered");
  }
  setHoveredStateKey(key);
}

function districtLayerForJoinKey(joinKey) {
  if (!joinKey || !state.districtLayerIndex) return null;
  if (state.districtLayerIndex.has(joinKey)) return state.districtLayerIndex.get(joinKey) || null;
  return null;
}

function selectDistrictFromTableRow(joinKey) {
  const layer = districtLayerForJoinKey(joinKey);
  if (!layer?.__featureRef || !layer.__dataMapRef) return;
  clearDistrictHoverOutline();
  clearSelectedDistrictOutline();
  hideDistrictHoverInfo();
  setSelectedDistrict(layer);
  const feature = layer.__featureRef;
  const joinInfo = extractJoinIds(feature.properties);
  const rec = layer.__dataMapRef.get(joinInfo.key);
  showDistrictDetailPanel(feature.properties, joinInfo, rec);
}

// ---------------------------------------------------------------------------
// Sidebar: national overview
// ---------------------------------------------------------------------------

// Two-button switch atop the national sidebar: the stat Overview vs the
// static ABEV Schedule (request / return / early-vote windows).
function nationalTabToggleHtml() {
  const btn = (value, label) =>
    `<button type="button" class="detail-chrono-btn${state.nationalTab === value ? " active-chrono" : ""}" data-national-tab="${value}">${label}</button>`;
  return `<div class="detail-chrono-buttons national-tab-buttons">${btn("overview", "Overview")}${btn("schedule", "Schedule")}</div>`;
}

function nationalOverviewHtml() {
  const body = state.nationalTab === "schedule" ? nationalScheduleHtml() : nationalStatTableHtml();
  return `${nationalTabToggleHtml()}${body}`;
}

// A cell in the Schedule table: the window text plus an optional circled-i. The
// tooltip text rides in data-tip (not the native title) so we can pop a custom
// bubble with a short delay; see the sched-tooltip handlers below.
function schedCellHtml(text, tip) {
  const info = tip
    ? ` <span class="sched-info" data-tip="${escapeHtml(tip)}" role="img" aria-label="${escapeHtml(tip)}" tabindex="0">&#9432;</span>`
    : "";
  return `<span class="sched-text">${escapeHtml(text)}</span>${info}`;
}

function isoToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// True when `today` falls inside [startIso, endIso]; a null bound is open. A
// request deadline is [now .. deadline], so it passes startIso = null.
function schedWindowActive(startIso, endIso, today) {
  if (startIso && today < startIso) return false;
  if (endIso && today > endIso) return false;
  return true;
}

function nationalScheduleHtml() {
  const rows = [];
  const seen = new Set();
  for (const { meta } of state.statesByKey.values()) {
    if (!meta?.key || seen.has(meta.key)) continue;
    const fips = normalizeStateFips(meta.fips);
    const sched = fips ? ABEV_SCHEDULE[fips] : null;
    if (!sched) continue;
    seen.add(meta.key);
    rows.push({ name: meta.name || meta.abbr || meta.key, stateKey: meta.key, sched });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const today = isoToday();
  // A cell dims when we're outside its window: All-mail request never dims;
  // a "None" early-voting cell always does.
  const cell = (text, tip, faded) =>
    `<td class="sched-cell${faded ? " sched-faded" : ""}">${schedCellHtml(text, tip)}</td>`;

  const body = rows
    .map((r) => {
      const s = r.sched;
      const reqFade = s.request !== "All-mail" && !schedWindowActive(null, s.reqEnd, today);
      const retFade = !schedWindowActive(s.retStart, s.retEnd, today);
      const evFade = s.ev === "None" || !schedWindowActive(s.evStart, s.evEnd, today);
      return `
        <tr class="target-row state-select-row" data-state-key="${escapeHtml(r.stateKey)}">
          <td class="abev-name-cell">${escapeHtml(r.name)}</td>
          ${cell(s.request, s.requestTip, reqFade)}
          ${cell(s.ret, s.retTip, retFade)}
          ${cell(s.ev, s.evTip, evFade)}
        </tr>`;
    })
    .join("");

  return `
    <div class="national-overview-wrap sched-wrap">
      <div class="sched-caption">${escapeHtml(ABEV_SCHEDULE_LABEL)}</div>
      <table class="abev-table sched-table">
        <thead>
          <tr>
            <th>State</th>
            <th>AB Request by</th>
            <th>AB Return</th>
            <th>Early Voting</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

// --- Schedule tooltip: a body-level fixed bubble with a short hover delay
// (native title is too slow, and a sidebar-nested CSS bubble would be clipped).
let schedTipEl = null;
let schedTipTimer = null;
function schedTooltipEl() {
  if (!schedTipEl) {
    schedTipEl = document.createElement("div");
    schedTipEl.className = "sched-tooltip";
    schedTipEl.hidden = true;
    document.body.appendChild(schedTipEl);
  }
  return schedTipEl;
}
function showSchedTooltip(icon) {
  const tip = icon.getAttribute("data-tip");
  if (!tip) return;
  const el = schedTooltipEl();
  el.textContent = tip;
  el.hidden = false;
  const r = icon.getBoundingClientRect();
  const m = 8;
  let left = r.left + r.width / 2 - el.offsetWidth / 2;
  left = Math.max(m, Math.min(left, window.innerWidth - el.offsetWidth - m));
  let top = r.top - el.offsetHeight - 8;
  if (top < m) top = r.bottom + 8; // flip below when there's no room above
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
function hideSchedTooltip() {
  if (schedTipTimer) {
    clearTimeout(schedTipTimer);
    schedTipTimer = null;
  }
  if (schedTipEl) schedTipEl.hidden = true;
}

function nationalStatTableHtml() {
  const rows = nationalOverviewRows();
  if (!rows.length) {
    return '<div class="loading-indicator">No ABEV data loaded yet.</div>';
  }

  const usTotals = {};
  for (const stat of DETAIL_STATS) {
    usTotals[stat] = sumStatTotals(rows.map((r) => r.rec), stat);
  }

  const headCells = DETAIL_STATS
    .map((stat) => {
      const selected = mapStat() === stat ? " stat-col-selected" : "";
      return `<th class="abev-sortable${selected}" data-sort-scope="national" data-sort-key="${stat}">${escapeHtml(DETAIL_STAT_SHORT[stat])}${sortIndicator(state.nationalSort, stat)}</th>`;
    })
    .join("");

  const usCells = DETAIL_STATS
    .map((stat) => {
      const t = usTotals[stat];
      const selected = mapStat() === stat ? " stat-col-selected" : "";
      const netPct = netPctFromTotals(t);
      return `
        <td class="stat-cell${selected}">
          <span class="stat-cell-count">${escapeHtml(formatCount(t.total))}</span>
          <span class="stat-cell-net ${netClass(netPct)}">${escapeHtml(formatNetPct(netPct))}</span>
        </td>
      `;
    })
    .join("");

  const body = rows
    .map((row) => {
      const cells = DETAIL_STATS.map((stat) => statCellHtml(row.rec, stat)).join("");
      return `
        <tr class="target-row state-select-row" data-state-key="${escapeHtml(row.stateKey)}">
          <td class="abev-name-cell">${escapeHtml(row.stateName)}</td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  return `
    <div class="national-overview-wrap">
      <table class="abev-table">
        <thead>
          <tr>
            <th class="abev-sortable" data-sort-scope="national" data-sort-key="state">State${sortIndicator(state.nationalSort, "state")}</th>
            ${headCells}
          </tr>
        </thead>
        <tbody>
          <tr class="abev-total-row">
            <td class="abev-name-cell">United States</td>
            ${usCells}
          </tr>
          ${body}
        </tbody>
      </table>
    </div>
  `;
}

function nationalOverviewRows() {
  const rows = [];
  const seen = new Set();

  for (const { meta } of state.statesByKey.values()) {
    if (!meta?.key || seen.has(meta.key)) continue;
    const stateFips = normalizeStateFips(meta.fips);
    if (!stateFips) continue;
    seen.add(meta.key);

    const rec = state.nationalByFips.get(stateFips) || null;
    if (!rec) continue;

    rows.push({
      stateKey: meta.key,
      stateName: meta.name || meta.abbr || meta.key,
      rec,
    });
  }

  rows.sort((a, b) => a.stateName.localeCompare(b.stateName));
  return applySort(rows, state.nationalSort, (row, key) => {
    if (key === "state") return row.stateName;
    const totals = statTotals(row.rec, key);
    return totals ? totals.total : Number.NEGATIVE_INFINITY;
  });
}

function stateHoverHtml(meta, rec) {
  const title = `<div class="detail-title">${escapeHtml(meta.name || meta.abbr || meta.key)}</div>`;
  if (!rec) {
    return `${title}<div class="detail-meta-muted">No ABEV data.</div>`;
  }
  return `${title}${hoverStatTableHtml(rec)}`;
}

// ---------------------------------------------------------------------------
// Sidebar: state chamber overview
// ---------------------------------------------------------------------------

function resetSidebarScroll() {
  const sidebar = details?.closest?.(".sidebar");
  if (sidebar) sidebar.scrollTop = 0;
}

function setDetailsLoading(message) {
  details.innerHTML = `<div class="loading-indicator">${escapeHtml(message)}</div>`;
}

function selectedStateChamberHeader() {
  if (state.chronoMode) {
    const name = state.selectedState?.name || state.selectedState?.abbr || "State";
    return `${name} — ${chronoModeLabel(state.chronoMode, state.chronoCumulative)}`;
  }
  return chamberDisplayName();
}

function showStateChamberOverview(options = {}) {
  if (state.mode !== "state" || !state.selectedState) return;
  state.detailsRenderToken += 1;
  const renderToken = state.detailsRenderToken;
  detailsTitle.textContent = selectedStateChamberHeader();
  requestAnimationFrame(() => {
    if (state.mode !== "state" || renderToken !== state.detailsRenderToken) return;
    details.innerHTML = stateChamberOverviewHtml();
    wireDetailsInteractions();
    if (!options.preserveScroll) resetSidebarScroll();
  });
}

function statewideCardsHtml() {
  const fips = normalizeStateFips(state.selectedState?.fips);
  return viewCardsHtml(state.nationalByFips.get(fips) || null);
}

// The three view switches, showing whichever record they sit above: statewide
// totals on the chamber overview, the district's own on its detail panel.
function viewCardsHtml(rec) {
  const cards = ABEV_VIEWS
    .map((view) => {
      const stat = VIEW_MAP_STAT[view];
      const totals = rec ? statTotals(rec, stat) : null;
      const selected = state.abevView === view ? " stat-card-selected" : "";
      const value = totals && totals.total > 0 ? formatCount(totals.total) : "—";
      const netPct = netPctFromTotals(totals);
      const net = typeof netPct === "number"
        ? `<span class="stat-card-net ${netClass(netPct)}">${escapeHtml(formatNetPct(netPct))}</span>`
        : "";
      return `
        <div class="stat-card${selected}" data-view="${view}" role="button" tabindex="0" title="Switch to ${escapeHtml(VIEW_CARD_LABELS[view])} view">
          <span class="stat-card-label">${escapeHtml(VIEW_CARD_LABELS[view])}</span>
          <span class="stat-card-value">${escapeHtml(value)}</span>
          ${net}
        </div>
      `;
    })
    .join("");

  return `<div class="statewide-stats-grid three-cards">${cards}</div>`;
}

// Districts / Daily / Weekly selector shown under the statewide cards, with the
// view's own option box below it: past-cycle columns in the district table, or
// period-vs-running totals in a chrono view.
function stateChronoButtonsHtml() {
  const current = state.chronoMode || "districts";
  const button = (value, label) =>
    `<button type="button" class="detail-chrono-btn${current === value ? " active-chrono" : ""}" data-state-chrono="${value}">${label}</button>`;
  return `
    <div class="detail-chrono-buttons state-chrono-buttons">
      ${button("districts", "Districts")}
      ${button("daily", "Daily")}
      ${button("weekly", "Weekly")}
    </div>
    ${state.chronoMode
      ? chronoOptionBoxesHtml(state.chronoMode, state.chronoCumulative, "state-chrono-cum", null)
      : historyModeButtonsHtml()}
  `;
}

// The two option boxes a chrono view carries, side by side when both apply.
function chronoOptionBoxesHtml(mode, cumulative, dataAttr, joinKey) {
  const boxes = `${chronoCumulativeBoxHtml(mode, cumulative, dataAttr)}${historyModeButtonsHtml({ chrono: true, joinKey })}`;
  return `<div class="option-box-row">${boxes}</div>`;
}

// A/B under the Daily/Weekly buttons: each period on its own, or the running
// total through it. Same quiet box as the Historical ABEV selector — both are
// options on the view above them, not view switches.
function chronoCumulativeBoxHtml(mode, cumulative, dataAttr) {
  if (!mode) return "";
  const button = (value, label, title) =>
    `<button type="button" class="option-btn${cumulative === value ? " option-btn-active" : ""}" data-${dataAttr}="${value ? "1" : "0"}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
  return `
    <div class="option-box">
      <div class="option-box-title">${escapeHtml(CHRONO_MODE_LABELS[mode] || "Daily")} Totals</div>
      <div class="option-box-buttons">
        ${button(false, CHRONO_PERIOD_LABELS[mode] || CHRONO_PERIOD_LABELS.daily, "Each period counted on its own")}
        ${button(true, "Cumulative", "Running total through each period")}
      </div>
    </div>
  `;
}

// Controls the 2022/2024 columns wherever they appear. `chrono` switches the
// wording: in the district table the columns are a single as-of snapshot, while
// in a chrono table every row aligns to its own days-out. Hidden for states with
// no backfill (and districts with no past-cycle record).
function historyModeButtonsHtml({ chrono = false, joinKey = null } = {}) {
  const available = chrono && joinKey
    ? HISTORY_YEARS.some((year) => !!historyRecordFor(year, joinKey))
    : historyAvailableForSelectedState();
  if (!available) return "";

  const active = historyModeFor({ chrono });
  const daysOut = daysOutFromElectionDay();
  const button = (value, label, title) =>
    `<button type="button" class="option-btn${active === value ? " option-btn-active" : ""}" data-history-mode="${value}" title="${escapeHtml(title)}">${label}</button>`;
  const onThisDayTitle = chrono
    ? "Each row against the same days-out in 2022 / 2024"
    : `2022 / 2024 as of ${daysOut} days before their own election day`;
  const note = active === "onthisday"
    ? chrono
      ? "each row aligned to the same days-out in 2022 / 2024"
      : `As of ${daysOut} days before election.`
    : active === "final"
      ? "ABEV totals on election day."
      : "";
  return `
    <div class="option-box">
      <div class="option-box-title">Historical ABEV</div>
      <div class="option-box-buttons">
        ${button("none", "None", "Hide the 2022 and 2024 columns")}
        ${button("onthisday", "On This Day", onThisDayTitle)}
        ${chrono ? "" : button("final", "Final Results", "2022 / 2024 complete election-day totals")}
      </div>
      ${note ? `<div class="option-box-note">${escapeHtml(note)}</div>` : ""}
    </div>
  `;
}

// Current-cycle header labels, split across two lines so a long label breaks
// instead of widening its column.
const STAT_HEAD_LINES = {
  voted: ["2026 ABEV", "Votes"],
};

// Past-cycle headers, per view. The year rides on the first line with the stat
// name so the break lands where it keeps the column narrowest
// ("2024 AB" / "Returned", not "2024" / "AB Returned").
const HISTORY_HEAD_LINES = {
  ab: { count: (y) => [`${y} AB`, "Returned"], margin: (y) => [`${y} Ret.`, "Margin"] },
  ev: { count: (y) => [`${y} EV`, "Total"], margin: (y) => [`${y} EV`, "Margin"] },
  abev: { count: (y) => [`${y} ABEV`, "Total"], margin: (y) => [`${y} ABEV`, "Margin"] },
};

const MARGIN_HEAD_LINES = {
  voted: ["2026 ABEV", "Margin"],
};

// Column layouts per view. "gap" entries render as thin separator columns;
// labels are arrays of lines so headers wrap onto exactly two lines.
// `withHistory` is the district-table shape: past cycles first, then the current
// one, so the columns read left-to-right as 2022 -> 2024 -> 2026. Chrono tables
// call this without the flag and never show past cycles.
function viewColumnDefs(view, { withHistory = false, chrono = false } = {}) {
  let cols;
  if (view === "ab") {
    cols = [
      { type: "gap" },
      { key: "requested", kind: "count", label: ["2026", "Requested"], sortKey: "requested" },
      { key: "requested", kind: "margin", label: ["2026 Req.", "Margin"], sortKey: "requested_margin" },
      { type: "gap" },
      { key: "returned", kind: "count", label: ["2026 AB", "Returned"], sortKey: "returned" },
      { key: "returned", kind: "margin", label: ["2026 Ret.", "Margin"], sortKey: "returned_margin" },
    ];
  } else if (view === "ev") {
    cols = [
      { type: "gap" },
      { key: "ev", kind: "count", label: ["2026 EV", "Total"], sortKey: "ev" },
      { key: "ev", kind: "margin", label: ["2026 EV", "Margin"], sortKey: "ev_margin" },
    ];
  } else {
    cols = [
      { type: "gap" },
      { key: "returned", kind: "count", label: ["2026 AB", "Returned"], sortKey: "returned" },
      { key: "ev", kind: "count", label: ["2026 EV", "Total"], sortKey: "ev" },
      { type: "gap" },
      { key: "voted", kind: "count", label: STAT_HEAD_LINES.voted, sortKey: "voted" },
      { key: "voted", kind: "margin", label: MARGIN_HEAD_LINES.voted, sortKey: "voted_margin" },
    ];
  }
  // No columns at all for a state with no backfill — otherwise a historyMode
  // carried over from another state renders four columns of "—".
  if (!withHistory || historyModeFor({ chrono }) === "none" || !historyAvailableForSelectedState()) return cols;

  // Each year opens with its own gap, and `cols` already starts with one, so
  // every group stays framed on both sides with no doubled separators.
  // Headers mirror the 2026 columns beside them, broken at the same point so
  // each column stays as narrow as its longest word.
  const stat = VIEW_MAP_STAT[view] || "voted";
  const heads = HISTORY_HEAD_LINES[view] || HISTORY_HEAD_LINES.abev;

  const history = [];
  for (const year of HISTORY_YEARS) {
    // A year on retired district lines keeps its columns — so the years line up
    // with every other state — but every cell reads N/A.
    const na = !historyYearAppliesToSelectedState(year);
    history.push(
      { type: "gap" },
      { key: stat, year, na, kind: "count", label: heads.count(year), sortKey: `hist${year}` },
      { key: stat, year, na, kind: "margin", label: heads.margin(year), sortKey: `hist${year}_margin` },
    );
  }
  return [...history, ...cols];
}

function columnLabelHtml(col) {
  return (col.label || []).map((line) => escapeHtml(line)).join("<br>");
}

// Columns flanking a gap get border lines on the gap side, so every vertical
// break is framed on both sides.
function columnVlineClass(cols, idx) {
  let cls = "";
  if (idx > 0 && cols[idx - 1]?.type === "gap") cls += " abev-vline-left";
  if (cols[idx + 1]?.type === "gap") cls += " abev-vline-right";
  return cls;
}

// Header + body cells for a view's stat columns (returned/ev/voted etc.),
// shared by the full district table, the target-district tables and the chrono
// tables. Both district tables pass withHistory so they stay in sync; the chrono
// tables don't. Target tables pass sortable:false.
function viewColumnHeadCellsHtml(cols, { sortable = true } = {}) {
  return cols
    .map((col, idx) => {
      if (col.type === "gap") return '<th class="abev-gap-cell"></th>';
      const vline = columnVlineClass(cols, idx);
      if (!sortable) return `<th class="${vline.trim()}">${columnLabelHtml(col)}</th>`;
      return `<th class="abev-sortable${vline}" data-sort-scope="district" data-sort-key="${col.sortKey}">${columnLabelHtml(col)}${sortIndicator(state.districtSort, col.sortKey)}</th>`;
    })
    .join("");
}

// Both cells of a past cycle whose lines no longer match today's map.
function historyNaCellHtml(col, vline) {
  const title = "Districts were redrawn after this election";
  const cls = col.kind === "count" ? "abev-count-cell count-cell-na" : "margin-cell margin-cell-na";
  return `<td class="${cls}${vline}" title="${title}">N/A</td>`;
}

function viewColumnBodyCellsHtml(cols, rec, joinKey = null) {
  return cols
    .map((col, idx) => {
      if (col.type === "gap") return '<td class="abev-gap-cell"></td>';
      const vline = columnVlineClass(cols, idx);
      if (col.na) return historyNaCellHtml(col, vline);
      const totals = col.year
        ? (joinKey ? historyTotals(joinKey, col.year, col.key) : null)
        : (rec ? statTotals(rec, col.key) : null);
      if (col.kind === "count") {
        return `<td class="abev-count-cell${vline}">${totals ? escapeHtml(formatCount(totals.total)) : "—"}</td>`;
      }
      return marginCellHtml(netPctFromTotals(totals), vline);
    })
    .join("");
}

// Incumbent-party cell for the full district table. Districts with no District
// Explorer record render blank rather than "O" — the party is unknown there,
// not "other".
function incCellHtml(joinKey) {
  const deRec = deRecordFor(joinKey);
  if (!deRec) return '<td class="inc-cell abev-vline-right"></td>';
  const party = incumbentPartyCode(deRec);
  return `<td class="inc-cell inc-${party.toLowerCase()} abev-vline-right"><strong>${escapeHtml(party)}</strong></td>`;
}

function districtTableHtml() {
  const allRows = districtRowsForSelectedState();
  const rows = allRows.filter((row) => districtPassesTableFilters(row.joinKey));
  if (!rows.length) {
    const message = allRows.length && state.upIn2026Mode
      ? "No districts in this chamber are up in 2026."
      : "No district-level ABEV data for this chamber.";
    return `<div class="loading-indicator">${escapeHtml(message)}</div>`;
  }
  const cols = viewColumnDefs(state.abevView, { withHistory: true });
  const legCols = legMarginColumnsForChamber();

  const headCells = viewColumnHeadCellsHtml(cols);

  const body = rows
    .map((row) => {
      const cells = viewColumnBodyCellsHtml(cols, row.rec, row.joinKey);
      return `
        <tr class="target-row district-select-row" data-join-key="${escapeHtml(row.joinKey)}">
          <td class="abev-name-cell abev-vline-left">${escapeHtml(row.label)}</td>
          ${incCellHtml(row.joinKey)}
          ${legCols.length ? `<td class="abev-gap-cell"></td>${legMarginCellsHtml(row.joinKey, legCols, { frame: true })}` : ""}
          ${cells}
        </tr>
      `;
    })
    .join("");

  const legHead = legCols.length
    ? `<th class="abev-gap-cell"></th>${legMarginHeadCellsHtml(legCols, { frame: true })}`
    : "";
  const note = legRedistrictingNote();

  return `
    <table class="abev-table">
      <thead>
        <tr>
          <th class="abev-sortable abev-name-head abev-vline-left" data-sort-scope="district" data-sort-key="district">Dist${sortIndicator(state.districtSort, "district")}</th>
          <th class="abev-sortable target-col-inc abev-vline-right" data-sort-scope="district" data-sort-key="inc">Inc${sortIndicator(state.districtSort, "inc")}</th>
          ${legHead}
          ${headCells}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
    ${note ? `<div class="leg-redistricting-note">${escapeHtml(note)}</div>` : ""}
  `;
}

function stateChamberOverviewHtml() {
  return `
    ${statewideCardsHtml()}
    ${stateChronoButtonsHtml()}
    <div class="detail-break"></div>
    ${targetDistrictsSectionHtml()}
    <div class="detail-section-title centered-section-title">Districts</div>
    ${districtTableHtml()}
  `;
}

function districtRowsForSelectedState() {
  const dataMap = state.dataByChamber[state.chamber];
  const rows = [];
  for (const feature of state.currentDistrictFeatures || []) {
    const joinInfo = extractJoinIds(feature.properties);
    const rec = dataMap.get(joinInfo.key);
    rows.push({
      joinKey: joinInfo.key,
      label: displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId),
      sortValue: districtLabelSortValue(joinInfo.districtId),
      rec: rec || null,
    });
  }

  rows.sort((a, b) => compareDistrictLabels(a, b));
  return applySort(rows, state.districtSort, (row, key) => {
    if (key === "district") return row.sortValue;
    // R first, then D, then split/other; unknown (no DE record) last.
    if (key === "inc") {
      const deRec = deRecordFor(row.joinKey);
      if (!deRec) return Number.NEGATIVE_INFINITY;
      return { R: 3, D: 2, S: 1, O: 0 }[incumbentPartyCode(deRec)] ?? 0;
    }
    const legMatch = key.match(/^leg_(\d{4})$/);
    if (legMatch) {
      const margin = legMarginRPositive(deRecordFor(row.joinKey), Number(legMatch[1]));
      return typeof margin === "number" ? margin : Number.NEGATIVE_INFINITY;
    }
    const histMatch = key.match(/^hist(\d{4})(_margin)?$/);
    if (histMatch) {
      // An N/A column sorts like any other blank rather than by its hidden data.
      if (!historyYearAppliesToSelectedState(Number(histMatch[1]))) return Number.NEGATIVE_INFINITY;
      const totals = historyTotals(row.joinKey, Number(histMatch[1]), VIEW_MAP_STAT[state.abevView] || "voted");
      if (!totals) return Number.NEGATIVE_INFINITY;
      if (!histMatch[2]) return totals.total;
      const netPct = netPctFromTotals(totals);
      return typeof netPct === "number" ? netPct : Number.NEGATIVE_INFINITY;
    }
    if (!row.rec) return Number.NEGATIVE_INFINITY;
    const isMargin = key.endsWith("_margin");
    const stat = isMargin ? key.slice(0, -"_margin".length) : key;
    const totals = statTotals(row.rec, stat);
    if (!totals) return Number.NEGATIVE_INFINITY;
    if (isMargin) {
      const netPct = netPctFromTotals(totals);
      return typeof netPct === "number" ? netPct : Number.NEGATIVE_INFINITY;
    }
    return totals.total;
  });
}

function districtLabelSortValue(districtId) {
  const raw = String(districtId || "");
  if (/^[0-9]+$/.test(raw)) return Number(raw);
  return raw;
}

function compareDistrictLabels(a, b) {
  const av = a.sortValue;
  const bv = b.sortValue;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  if (typeof av === "number") return -1;
  if (typeof bv === "number") return 1;
  return String(av).localeCompare(String(bv));
}

// ---------------------------------------------------------------------------
// Sidebar: chronological views (Daily / Weekly, each period or cumulative)
// ---------------------------------------------------------------------------

const CHRONO_STATS = ["requested", "returned", "ev"];

function showChronoView(options = {}) {
  if (state.mode !== "state" || !state.selectedState || !state.chronoMode) return;
  state.detailsRenderToken += 1;
  const renderToken = state.detailsRenderToken;
  detailsTitle.textContent = selectedStateChamberHeader();
  requestAnimationFrame(() => {
    if (state.mode !== "state" || !state.chronoMode || renderToken !== state.detailsRenderToken) return;
    details.innerHTML = chronoViewHtml();
    wireDetailsInteractions();
    if (!options.preserveScroll) resetSidebarScroll();
  });
}

function chronoViewHtml() {
  const title = `${chronoModeLabel(state.chronoMode, state.chronoCumulative)} Returns`;
  return `
    ${statewideCardsHtml()}
    ${stateChronoButtonsHtml()}
    <div class="detail-break"></div>
    <div class="detail-section-title centered-section-title">${escapeHtml(title)}</div>
    ${chronoTableHtml(chronoRows(), { cumulative: state.chronoCumulative, joinKey: null })}
  `;
}

function electionDayForSelectedState() {
  const fips = normalizeStateFips(state.selectedState?.fips);
  return ELECTION_DAY_OVERRIDES[fips] || DEFAULT_ELECTION_DAY;
}

function abevStartForSelectedState() {
  const fips = normalizeStateFips(state.selectedState?.fips);
  return ABEV_START_OVERRIDES[fips] || null;
}

function localTodayIso() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}

// Convert a stored timeline record ({stat: [{date, rep, dem, toss}]}) into
// dateKey -> {stat: buckets}. Works for both statewide and district timelines.
function chronoByDate(tlRec) {
  if (!tlRec) return null;
  const byDate = new Map();
  for (const stat of CHRONO_STATS) {
    for (const row of tlRec[stat] || []) {
      const key = String(row.date || "unknown");
      if (!byDate.has(key)) byDate.set(key, {});
      byDate.get(key)[stat] = {
        rep: Number(row.rep || 0),
        dem: Number(row.dem || 0),
        toss: Number(row.toss || 0),
      };
    }
  }
  return byDate;
}

function emptyChronoStats() {
  const empty = () => ({ rep: 0, dem: 0, toss: 0 });
  return { requested: empty(), returned: empty(), ev: empty() };
}

function addChronoStats(target, stats) {
  for (const stat of CHRONO_STATS) {
    const buckets = stats?.[stat];
    if (!buckets) continue;
    target[stat].rep += buckets.rep;
    target[stat].dem += buckets.dem;
    target[stat].toss += buckets.toss;
  }
  return target;
}

function chronoStatsHaveData(stats) {
  return CHRONO_STATS.some((stat) => stats[stat].rep + stats[stat].dem + stats[stat].toss > 0);
}

// Build display rows from a timeline. Everything outside the state's ABEV
// window (before it opens, after election day, unknown/bad dates, pre-2026)
// folds into a single "Earlier" bucket so totals always account for every
// vote. In cumulative mode that bucket is the running-total baseline.
function buildChronoRows(byDate, mode, earlierLabel, cumulative = false) {
  if (!byDate || !byDate.size) return [];
  const todayIso = localTodayIso();
  const electionDay = electionDayForSelectedState();
  const cutoffIso = electionDay < todayIso ? electionDay : todayIso;
  const startIso = abevStartForSelectedState();

  const earlier = emptyChronoStats();
  const dateKeys = [];
  for (const [key, stats] of byDate) {
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(key);
    if (!isDate || key > cutoffIso || (startIso && key < startIso)) {
      addChronoStats(earlier, stats);
      continue;
    }
    dateKeys.push(key);
  }
  dateKeys.sort();
  const hasEarlier = chronoStatsHaveData(earlier);

  // One bucket per period, oldest first: a day each, or a Mon-Sun week each.
  let periods;
  if (mode === "weekly") {
    const weeks = new Map(); // Monday -> summed stats
    for (const key of dateKeys) {
      const weekStart = weekStartIso(key);
      if (!weeks.has(weekStart)) weeks.set(weekStart, emptyChronoStats());
      addChronoStats(weeks.get(weekStart), byDate.get(key));
    }
    // The span is clamped to the window like the label is, so the past-cycle
    // columns line up with exactly the days this row could have counted.
    periods = [...weeks.keys()].sort().map((weekStart) => {
      const weekEnd = addIsoDays(weekStart, 6);
      return {
        label: chronoWeekLabel(weekStart, startIso, cutoffIso),
        stats: weeks.get(weekStart),
        startIso: startIso && weekStart < startIso ? startIso : weekStart,
        endIso: cutoffIso && weekEnd > cutoffIso ? cutoffIso : weekEnd,
      };
    });
  } else {
    periods = dateKeys.map((key) => ({
      label: chronoDateLabel(key),
      stats: addChronoStats(emptyChronoStats(), byDate.get(key)),
      startIso: key,
      endIso: key,
    }));
  }

  // Cumulative starts from the "Earlier" bucket, so the newest row equals the
  // all-time total.
  if (cumulative) {
    const running = addChronoStats(emptyChronoStats(), earlier);
    for (const period of periods) {
      addChronoStats(running, period.stats);
      period.stats = structuredClone(running);
    }
  }

  const rows = periods.map((period) => ({ ...period, special: false })).reverse(); // newest first
  if (hasEarlier) rows.push({ label: earlierLabel, stats: earlier, special: true });
  return rows;
}

function chronoRows() {
  const fips = normalizeStateFips(state.selectedState?.fips);
  return buildChronoRows(
    chronoByDate(state.timelineByFips.get(fips)),
    state.chronoMode,
    "Earlier",
    state.chronoCumulative
  );
}

function chronoDateLabel(isoDate) {
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${Number(m[2])}/${Number(m[3])}`;
}

// Granularity (the Daily / Weekly buttons) and, under it, whether each row is
// that period alone or the running total through it.
const CHRONO_MODE_LABELS = { daily: "Daily", weekly: "Weekly" };
const CHRONO_PERIOD_LABELS = { daily: "Day-to-Day", weekly: "Week-to-Week" };

function chronoModeLabel(mode, cumulative) {
  if (cumulative) return "Cumulative";
  return CHRONO_PERIOD_LABELS[mode] || CHRONO_PERIOD_LABELS.daily;
}

function addIsoDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monday that starts the week containing `iso` (weeks run Mon -> Sun).
function weekStartIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return addIsoDays(iso, -((d.getUTCDay() + 6) % 7)); // getUTCDay: 0=Sun
}

// "3/9-3/15". The first and last weeks of a state's window are usually partial,
// so the ends are clamped to the window — a label never claims days the bucket
// could not have counted.
function chronoWeekLabel(weekStart, startIso, cutoffIso) {
  const weekEnd = addIsoDays(weekStart, 6);
  const from = startIso && weekStart < startIso ? startIso : weekStart;
  const to = cutoffIso && weekEnd > cutoffIso ? cutoffIso : weekEnd;
  return `${chronoDateLabel(from)}-${chronoDateLabel(to)}`;
}

function chronoStatTotals(stats, stat) {
  const get = (key) => stats[key] || { rep: 0, dem: 0, toss: 0 };
  let buckets;
  if (stat === "voted") {
    const returned = get("returned");
    const ev = get("ev");
    buckets = { rep: returned.rep + ev.rep, dem: returned.dem + ev.dem, toss: returned.toss + ev.toss };
  } else {
    buckets = get(stat);
  }
  const total = buckets.rep + buckets.dem + buckets.toss;
  return { ...buckets, total, net: buckets.rep - buckets.dem };
}

// `joinKey` scopes the past-cycle columns: a district's own history, or null for
// the statewide timeline.
function chronoTableHtml(rows, { cumulative = false, joinKey = null } = {}) {
  if (!rows.length) {
    return '<div class="loading-indicator">No chronological ABEV data available.</div>';
  }
  const cols = viewColumnDefs(state.abevView, { withHistory: true, chrono: true });

  const headCells = cols
    .map((col, idx) => {
      if (col.type === "gap") return '<th class="abev-gap-cell"></th>';
      return `<th class="${columnVlineClass(cols, idx).trim()}">${columnLabelHtml(col)}</th>`;
    })
    .join("");

  const body = rows
    .map((row) => {
      // Emptiness is judged on the current cycle only — a row is worth showing
      // or not on its own returns, not on what 2022 happened to do.
      const dataCols = cols.filter((col) => col.type !== "gap" && !col.year);
      const allZero = dataCols.every((col) => chronoStatTotals(row.stats, col.key).total === 0);
      // Period rows with no activity are noise; running totals keep every row.
      if (allZero && !cumulative && !row.special) return "";
      if (allZero && row.special) return "";
      const cells = cols
        .map((col, idx) => {
          if (col.type === "gap") return '<td class="abev-gap-cell"></td>';
          const vline = columnVlineClass(cols, idx);
          if (col.na) return historyNaCellHtml(col, vline);
          const totals = col.year
            ? chronoHistoryTotals(row, col.year, col.key, { cumulative, joinKey })
            : chronoStatTotals(row.stats, col.key);
          if (col.kind === "count") {
            return `<td class="abev-count-cell${vline}">${totals ? escapeHtml(formatCount(totals.total)) : "—"}</td>`;
          }
          const netPct = totals && totals.total > 0 ? (totals.net / totals.total) * 100 : null;
          return marginCellHtml(netPct, vline);
        })
        .join("");
      return `
        <tr class="target-row${row.special ? " chrono-special-row" : ""}">
          <td class="chrono-date-cell abev-vline-left abev-vline-right">${escapeHtml(row.label)}</td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  return `
    <table class="abev-table">
      <thead>
        <tr>
          <th class="abev-name-head abev-vline-left abev-vline-right">Date</th>
          ${headCells}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Trend graph (tab + overlay panel on the map)
// ---------------------------------------------------------------------------

const TREND_COLORS = {
  rep: "#f82644",
  dem: "#3d8bff",
  toss: "#a86edd",
  margin: "#f2f6fa",
};

// Layout constants for the SVG chart (viewBox units).
const TREND_W = 720;
const TREND_H = 340;
const TREND_PAD = { top: 16, right: 58, bottom: 34, left: 60 };

let trendRenderCache = null; // { points, xOf, leftMax, rightMax } for tooltip lookups

function initTrendChart() {
  const container = map.getContainer();

  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "trend-tab";
  tab.innerHTML = 'Trend Graph <span class="trend-tab-arrow">▾</span>';
  tab.setAttribute("aria-label", "Toggle trend graph");
  tab.addEventListener("click", () => {
    if (!trendChartContext()) return;
    state.trendChartOpen = !state.trendChartOpen;
    updateTrendChartUi();
  });
  container.appendChild(tab);

  const panel = document.createElement("div");
  panel.className = "trend-panel";
  panel.hidden = true;
  container.appendChild(panel);

  panel.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.trendEndToday !== undefined) {
      state.trendChartEndAtToday = target.checked;
      renderTrendChart();
      return;
    }
    const year = Number(target.dataset.trendYear || 0);
    if (year) {
      state.trendYears[year] = target.checked;
      renderTrendChart();
    }
  });

  // Keep map gestures from firing through the overlay UI.
  for (const el of [tab, panel]) {
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }

  state.trendTabEl = tab;
  state.trendPanelEl = panel;
}

// What the graph should show right now, or null when it is unavailable
// (national view, or the plain statewide district-table view).
function trendChartContext() {
  if (state.mode !== "state" || !state.selectedState) return null;

  const layer = state.selectedDistrictLayer;
  if (layer?.__featureRef) {
    const joinInfo = extractJoinIds(layer.__featureRef.properties);
    const rec = layer.__dataMapRef?.get(joinInfo.key);
    return {
      title: districtTitle(layer.__featureRef.properties, joinInfo),
      timeline: rec?.timeline || null,
      joinKey: joinInfo.key,
      mode: state.detailChronoMode,
      cumulative: state.detailChronoCumulative,
    };
  }

  if (state.chronoMode) {
    const fips = normalizeStateFips(state.selectedState.fips);
    return {
      title: state.selectedState.name || state.selectedState.abbr || "State",
      timeline: state.timelineByFips.get(fips) || null,
      joinKey: null,
      mode: state.chronoMode,
      cumulative: state.chronoCumulative,
    };
  }

  return null;
}

function updateTrendChartUi() {
  const tab = state.trendTabEl;
  const panel = state.trendPanelEl;
  if (!tab || !panel) return;

  const inState = state.mode === "state";
  const ctx = inState ? trendChartContext() : null;
  const available = !!ctx;

  tab.classList.toggle("trend-tab-hidden", !inState);
  tab.classList.toggle("trend-tab-disabled", !available);
  tab.disabled = !available;

  if (!available && state.trendChartOpen) {
    state.trendChartOpen = false; // auto-close when returning to the district-table view
  }

  const open = available && state.trendChartOpen;
  tab.classList.toggle("trend-tab-open", open);
  panel.hidden = !open;
  if (open) renderTrendChart();
}

function trendIsoDateRe() {
  return /^\d{4}-\d{2}-\d{2}$/;
}

function nextIsoDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function daysBetweenIso(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

function trendCurrentYear() {
  return Number(electionDayForSelectedState().slice(0, 4));
}

// Which cycles this scope could draw, oldest first. A past year only counts if
// the scope (district or state) actually has a backfilled timeline, and if its
// district lines still match today's — a year that reads N/A in the tables has
// no line to draw either.
function trendYearsForScope(ctx) {
  const years = HISTORY_YEARS.filter(
    (year) => historyYearAppliesToSelectedState(year) && !!historyTimelineForScope(year, ctx.joinKey)
  );
  years.push(trendCurrentYear());
  return years;
}

function trendSelectedYears(ctx) {
  return trendYearsForScope(ctx).filter((year) => state.trendYears[year]);
}

// A year's timeline keyed by date, with past years shifted onto the current
// cycle's calendar — each date re-expressed as the day that sits the same
// distance from this cycle's election day. That puts every year on one x-axis.
// Undated past-year rows are dropped rather than folded into the baseline, for
// the same reason historyTotalsInRange skips them.
function trendByDateForYear(ctx, year) {
  if (year === trendCurrentYear()) return chronoByDate(ctx.timeline);

  const byDate = chronoByDate(historyTimelineForScope(year, ctx.joinKey));
  if (!byDate) return null;
  const pastElectionDay = HISTORY_ELECTION_DAYS[year];
  const electionDay = electionDayForSelectedState();
  const isoRe = trendIsoDateRe();

  const shifted = new Map();
  for (const [key, stats] of byDate) {
    if (!isoRe.test(key)) continue;
    const at = addIsoDays(electionDay, -daysBetweenIso(key, pastElectionDay));
    if (!shifted.has(at)) shifted.set(at, emptyChronoStats());
    addChronoStats(shifted.get(at), stats);
  }
  return shifted;
}

// Build the chart's day-by-day series. Mirrors buildChronoRows(): everything
// outside the state's ABEV window folds into a baseline that seeds the
// cumulative running totals, so the last cumulative point matches the tables.
function buildTrendSeries(ctx) {
  const years = trendSelectedYears(ctx);
  if (!years.length) return null;

  const stat = mapStat();
  const isoRe = trendIsoDateRe();
  const todayIso = localTodayIso();
  const electionDay = electionDayForSelectedState();

  const currentByDate = chronoByDate(ctx.timeline);
  const dataDates = [...(currentByDate?.keys() || [])].filter((k) => isoRe.test(k)).sort();
  const start = abevStartForSelectedState() || dataDates[0] || null;
  if (!start) return null;

  // X-axis domain: ABEV start -> election day, or -> today when toggled.
  const domainEnd = state.trendChartEndAtToday
    ? (todayIso < electionDay ? todayIso : electionDay)
    : electionDay;
  if (domainEnd < start) return null;

  const cutoff = electionDay < todayIso ? electionDay : todayIso;
  const series = [];
  for (const year of years) {
    const byDate = trendByDateForYear(ctx, year);
    if (!byDate || !byDate.size) continue;
    // Past cycles are finished, so they run the full domain; only the current
    // one stops at today.
    const yearCutoff = year === trendCurrentYear() ? cutoff : domainEnd;
    const points = trendPointsFor(byDate, { ctx, stat, start, domainEnd, cutoff: yearCutoff, isoRe });
    if (points.length) series.push({ year, points });
  }
  if (!series.length) return null;
  return { series, start, end: domainEnd, stat };
}

function trendPointsFor(byDate, { ctx, stat, start, domainEnd, cutoff, isoRe }) {
  const baseline = emptyChronoStats();
  const inWindow = new Map();
  for (const [key, stats] of byDate) {
    if (!isoRe.test(key) || key > cutoff || key < start) {
      addChronoStats(baseline, stats);
      continue;
    }
    inWindow.set(key, stats);
  }

  // Lines stop at the last day that can have data; the axis keeps running.
  let lastData = cutoff < domainEnd ? cutoff : domainEnd;
  if (lastData < start) lastData = start;

  const points = [];

  // Weekly: one point per Mon-Sun bucket, plotted at the week's last counted
  // day so it sits at the end of the span it summarizes.
  if (ctx.mode === "weekly") {
    const weekTotals = new Map();
    for (const [key, stats] of inWindow) {
      const weekStart = weekStartIso(key);
      if (!weekTotals.has(weekStart)) weekTotals.set(weekStart, emptyChronoStats());
      addChronoStats(weekTotals.get(weekStart), stats);
    }
    const weekRunning = addChronoStats(emptyChronoStats(), baseline);
    for (let weekStart = weekStartIso(start); weekStart <= lastData; weekStart = addIsoDays(weekStart, 7)) {
      const weekStats = weekTotals.get(weekStart) || emptyChronoStats();
      if (ctx.cumulative) addChronoStats(weekRunning, weekStats);
      const totals = chronoStatTotals(ctx.cumulative ? weekRunning : weekStats, stat);
      let at = addIsoDays(weekStart, 6);
      if (at > lastData) at = lastData;
      if (at < start) at = start;
      points.push({
        date: at,
        rep: totals.rep,
        dem: totals.dem,
        toss: totals.toss,
        netPct: totals.total > 0 ? (totals.net / totals.total) * 100 : null,
      });
    }
    return points;
  }

  const running = addChronoStats(emptyChronoStats(), baseline);
  for (let day = start; day <= lastData; day = nextIsoDay(day)) {
    const dayStats = inWindow.get(day) || null;
    let totals;
    if (ctx.cumulative) {
      if (dayStats) addChronoStats(running, dayStats);
      totals = chronoStatTotals(running, stat);
    } else {
      totals = chronoStatTotals(dayStats || emptyChronoStats(), stat);
    }
    points.push({
      date: day,
      rep: totals.rep,
      dem: totals.dem,
      toss: totals.toss,
      netPct: totals.total > 0 ? (totals.net / totals.total) * 100 : null,
    });
  }

  return points;
}

function trendNiceCeil(value) {
  if (!(value > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / pow;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return mult * pow;
}

function trendAxisCount(value) {
  if (value >= 1e6) return `${Number((value / 1e6).toFixed(1))}M`;
  if (value >= 1000) return `${Number((value / 1000).toFixed(value >= 10000 ? 0 : 1))}k`;
  return String(Math.round(value));
}

function trendAxisMargin(value) {
  if (Math.abs(value) < 0.05) return "0";
  const abs = Number(Math.abs(value).toFixed(1));
  return value > 0 ? `R+${abs}` : `D+${abs}`;
}

function renderTrendChart() {
  const panel = state.trendPanelEl;
  if (!panel) return;
  const ctx = trendChartContext();
  if (!ctx) return;

  const modeLabel = chronoModeLabel(ctx.mode, ctx.cumulative);
  const statLabel = STAT_LABELS[mapStat()] || "Votes";
  const series = buildTrendSeries(ctx);
  trendRenderCache = null;

  const availableYears = trendYearsForScope(ctx);
  const yearToggles = availableYears
    .map((year) => `
      <label class="trend-year-toggle">
        <input type="checkbox" data-trend-year="${year}" ${state.trendYears[year] ? "checked" : ""} />
        ${year}
      </label>
    `)
    .join("");

  const header = `
    <div class="trend-header">
      <div class="trend-title">${escapeHtml(ctx.title)} — ${escapeHtml(modeLabel)} ${escapeHtml(statLabel)}</div>
      <div class="trend-controls">
        ${availableYears.length > 1 ? `<span class="trend-year-toggles">${yearToggles}</span>` : ""}
        <label class="trend-end-toggle">
          <input type="checkbox" data-trend-end-today ${state.trendChartEndAtToday ? "checked" : ""} />
          End graph at current date
        </label>
      </div>
    </div>
  `;

  if (!series || !series.series.length) {
    const message = trendSelectedYears(ctx).length
      ? "No chronological ABEV data available."
      : "Select a cycle to graph.";
    panel.innerHTML = `${header}<div class="trend-empty">${escapeHtml(message)}</div>`;
    return;
  }

  // Past cycles share the party colors and are told apart by line style, so the
  // legend explains the colors once and the styles once.
  const yearKeys = series.series.length > 1
    ? series.series
        .map((s) => `<span class="trend-legend-item"><span class="trend-swatch trend-swatch-line" style="border-top-style:${trendYearStyle(s.year).legend}"></span>${s.year}</span>`)
        .join("")
    : "";

  const legend = `
    <div class="trend-legend">
      <span class="trend-legend-item"><span class="trend-swatch" style="background:${TREND_COLORS.rep}"></span>GOP</span>
      <span class="trend-legend-item"><span class="trend-swatch" style="background:${TREND_COLORS.dem}"></span>Dem</span>
      <span class="trend-legend-item"><span class="trend-swatch" style="background:${TREND_COLORS.toss}"></span>Swing</span>
      <span class="trend-legend-item"><span class="trend-swatch trend-swatch-dashed"></span>Net Margin % <span class="trend-legend-axis">(right axis)</span></span>
      ${yearKeys}
    </div>
  `;

  panel.innerHTML = `${header}${trendSvgHtml(series, ctx.mode)}${legend}<div class="trend-tooltip" hidden></div>`;
  wireTrendChartHover(panel);
}

// Line style per cycle: the current one solid and full strength, past ones
// progressively lighter and more broken up.
function trendYearStyle(year) {
  if (year === trendCurrentYear()) return { dash: "", width: 2, opacity: 1, legend: "solid" };
  if (year === Math.max(...HISTORY_YEARS)) return { dash: "7 4", width: 1.7, opacity: 0.8, legend: "dashed" };
  return { dash: "2 3", width: 1.5, opacity: 0.62, legend: "dotted" };
}

function trendSvgHtml(seriesSet, mode) {
  const { series, start, end } = seriesSet;
  const allPoints = series.flatMap((s) => s.points);
  const plotW = TREND_W - TREND_PAD.left - TREND_PAD.right;
  const plotH = TREND_H - TREND_PAD.top - TREND_PAD.bottom;
  const totalDays = Math.max(1, daysBetweenIso(start, end));

  // Axes are shared, so every selected cycle is measured on the same scale.
  const leftMax = trendNiceCeil(Math.max(1, ...allPoints.map((p) => Math.max(p.rep, p.dem, p.toss))));
  const rawMarginMax = Math.max(0, ...allPoints.map((p) => (typeof p.netPct === "number" ? Math.abs(p.netPct) : 0)));
  const rightMax = Math.min(100, Math.max(5, Math.ceil(rawMarginMax / 5) * 5));

  const xOf = (iso) => TREND_PAD.left + (daysBetweenIso(start, iso) / totalDays) * plotW;
  const yLeft = (v) => TREND_PAD.top + plotH - (Math.max(0, Math.min(leftMax, v)) / leftMax) * plotH;
  const yRight = (v) => TREND_PAD.top + plotH / 2 - (Math.max(-rightMax, Math.min(rightMax, v)) / rightMax) * (plotH / 2);

  trendRenderCache = { series, start, totalDays, leftMax, rightMax, mode };

  // Horizontal gridlines + left axis labels (quarters of leftMax).
  let grid = "";
  let leftLabels = "";
  for (let i = 0; i <= 4; i += 1) {
    const v = (leftMax * i) / 4;
    const y = yLeft(v);
    grid += `<line x1="${TREND_PAD.left}" y1="${y.toFixed(1)}" x2="${TREND_W - TREND_PAD.right}" y2="${y.toFixed(1)}" class="trend-grid" />`;
    leftLabels += `<text x="${TREND_PAD.left - 6}" y="${(y + 3).toFixed(1)}" class="trend-axis-label trend-axis-left">${trendAxisCount(v)}</text>`;
  }

  // Right axis labels (margin) + a dotted zero line for that axis.
  let rightLabels = "";
  for (const v of [rightMax, rightMax / 2, 0, -rightMax / 2, -rightMax]) {
    rightLabels += `<text x="${TREND_W - TREND_PAD.right + 6}" y="${(yRight(v) + 3).toFixed(1)}" class="trend-axis-label trend-axis-right ${v > 0 ? "trend-axis-r" : v < 0 ? "trend-axis-d" : ""}">${trendAxisMargin(v)}</text>`;
  }
  const zeroLine = `<line x1="${TREND_PAD.left}" y1="${yRight(0).toFixed(1)}" x2="${TREND_W - TREND_PAD.right}" y2="${yRight(0).toFixed(1)}" class="trend-zero-line" />`;

  // X ticks: ~6 evenly spaced days across the domain.
  let xLabels = "";
  const tickStep = Math.max(1, Math.ceil(totalDays / 6));
  for (let dayIdx = 0; dayIdx <= totalDays; dayIdx += tickStep) {
    let iso = start;
    for (let i = 0; i < dayIdx; i += 1) iso = nextIsoDay(iso);
    const x = TREND_PAD.left + (dayIdx / totalDays) * plotW;
    xLabels += `<text x="${x.toFixed(1)}" y="${TREND_H - TREND_PAD.bottom + 16}" class="trend-axis-label trend-axis-x">${chronoDateLabel(iso)}</text>`;
  }

  const linePath = (points, valueOf) => {
    let d = "";
    let pen = false;
    for (const p of points) {
      const v = valueOf(p);
      if (typeof v !== "number") {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${xOf(p.date).toFixed(1)},${v.toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  // Oldest cycle first so the current one draws on top.
  let lines = "";
  let dots = "";
  for (const { year, points } of series) {
    const style = trendYearStyle(year);
    const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
    const line = (path, color, width) =>
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${style.opacity}" stroke-linejoin="round"${dash} />`;
    lines += line(linePath(points, (p) => yLeft(p.toss)), TREND_COLORS.toss, style.width);
    lines += line(linePath(points, (p) => yLeft(p.dem)), TREND_COLORS.dem, style.width);
    lines += line(linePath(points, (p) => yLeft(p.rep)), TREND_COLORS.rep, style.width);
    lines += `<path d="${linePath(points, (p) => (typeof p.netPct === "number" ? yRight(p.netPct) : null))}" fill="none" stroke="${TREND_COLORS.margin}" stroke-width="${(style.width - 0.2).toFixed(1)}" stroke-opacity="${style.opacity}" stroke-dasharray="5 4" stroke-linejoin="round" />`;

    // End dots make single-day series visible and mark the latest reading.
    const last = points[points.length - 1];
    if (!last) continue;
    const dot = (y, color) =>
      `<circle cx="${xOf(last.date).toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${color}" fill-opacity="${style.opacity}" />`;
    dots += dot(yLeft(last.rep), TREND_COLORS.rep);
    dots += dot(yLeft(last.dem), TREND_COLORS.dem);
    dots += dot(yLeft(last.toss), TREND_COLORS.toss);
    if (typeof last.netPct === "number") dots += dot(yRight(last.netPct), TREND_COLORS.margin);
  }

  return `
    <svg class="trend-svg" viewBox="0 0 ${TREND_W} ${TREND_H}" role="img" aria-label="ABEV trend graph">
      ${grid}
      ${zeroLine}
      ${leftLabels}
      ${rightLabels}
      ${xLabels}
      ${lines}
      ${dots}
      <line class="trend-crosshair" x1="0" y1="${TREND_PAD.top}" x2="0" y2="${TREND_H - TREND_PAD.bottom}" style="display:none" />
      <rect class="trend-hover-rect" x="${TREND_PAD.left}" y="${TREND_PAD.top}" width="${plotW}" height="${plotH}" fill="transparent" />
    </svg>
  `;
}

function wireTrendChartHover(panel) {
  const svg = panel.querySelector(".trend-svg");
  const hoverRect = panel.querySelector(".trend-hover-rect");
  const crosshair = panel.querySelector(".trend-crosshair");
  const tooltip = panel.querySelector(".trend-tooltip");
  if (!svg || !hoverRect || !crosshair || !tooltip) return;

  const hide = () => {
    crosshair.style.display = "none";
    tooltip.hidden = true;
  };

  hoverRect.addEventListener("mousemove", (e) => {
    const cache = trendRenderCache;
    if (!cache || !cache.series.length) return hide();

    const rect = svg.getBoundingClientRect();
    const viewX = ((e.clientX - rect.left) / rect.width) * TREND_W;
    const plotW = TREND_W - TREND_PAD.left - TREND_PAD.right;
    const dayIdx = Math.max(0, Math.min(cache.totalDays, Math.round(((viewX - TREND_PAD.left) / plotW) * cache.totalDays)));
    const hoveredIso = addIsoDays(cache.start, dayIdx);

    // Series can have different point spacing (weekly buckets, cycles that stop
    // at different dates), so each is sampled at the point nearest the cursor.
    const readings = [];
    for (const { year, points } of cache.series) {
      let best = null;
      let bestGap = Infinity;
      for (const p of points) {
        const gap = Math.abs(daysBetweenIso(p.date, hoveredIso));
        if (gap < bestGap) {
          bestGap = gap;
          best = p;
        }
      }
      if (best) readings.push({ year, point: best });
    }
    if (!readings.length) return hide();

    const x = TREND_PAD.left + (dayIdx / cache.totalDays) * plotW;
    crosshair.setAttribute("x1", x.toFixed(1));
    crosshair.setAttribute("x2", x.toFixed(1));
    crosshair.style.display = "";

    const multi = readings.length > 1;
    tooltip.innerHTML = `
      <div class="trend-tooltip-date">${chronoDateLabel(hoveredIso)}</div>
      ${readings
        .map(({ year, point }) => `
          ${multi ? `<div class="trend-tooltip-year">${year}</div>` : ""}
          <div><span class="trend-tt-r">GOP</span> ${escapeHtml(formatCount(point.rep))}</div>
          <div><span class="trend-tt-d">Dem</span> ${escapeHtml(formatCount(point.dem))}</div>
          <div><span class="trend-tt-t">Swing</span> ${escapeHtml(formatCount(point.toss))}</div>
          <div><span class="trend-tt-m">Margin</span> ${netPctHtml(point.netPct)}</div>
        `)
        .join("")}
    `;
    tooltip.hidden = false;

    // Position within the panel, flipping sides at the midpoint.
    const panelRect = panel.getBoundingClientRect();
    const pxX = rect.left - panelRect.left + (x / TREND_W) * rect.width;
    const onLeftHalf = x < TREND_W / 2;
    tooltip.style.left = onLeftHalf ? `${pxX + 12}px` : "auto";
    tooltip.style.right = onLeftHalf ? "auto" : `${panelRect.width - pxX + 12}px`;
    tooltip.style.top = `${rect.top - panelRect.top + 18}px`;
  });

  hoverRect.addEventListener("mouseleave", hide);
}

// ---------------------------------------------------------------------------
// Sorting (shared)
// ---------------------------------------------------------------------------

function applySort(rows, sortState, valueFor) {
  const key = sortState?.key || null;
  const direction = Number(sortState?.direction || 0);
  if (!key || direction === 0) return rows;

  return [...rows].sort((a, b) => {
    const av = valueFor(a, key);
    const bv = valueFor(b, key);
    if (typeof av === "string" || typeof bv === "string") {
      const cmp = String(av).localeCompare(String(bv));
      return direction === -1 ? -cmp : cmp;
    }
    if (av === bv) return 0;
    return direction === -1 ? bv - av : av - bv;
  });
}

function sortIndicator(sortState, key) {
  if (sortState?.key !== key || !sortState?.direction) return "";
  return sortState.direction === -1 ? " ▾" : " ▴";
}

function toggleSort(sortState, key) {
  if (sortState.key !== key) {
    sortState.key = key;
    sortState.direction = -1;
    return;
  }
  if (sortState.direction === -1) {
    sortState.direction = 1;
    return;
  }
  sortState.key = null;
  sortState.direction = 0;
}

// ---------------------------------------------------------------------------
// Sidebar: district detail
// ---------------------------------------------------------------------------

function showDistrictDetailPanel(properties, joinInfo, rec, options = {}) {
  state.detailsRenderToken += 1;
  detailsTitle.textContent = chamberDisplayName();
  details.innerHTML = districtDetailHtml(properties, joinInfo, rec);
  wireDetailsInteractions();
  if (!options.preserveScroll) resetSidebarScroll();
  updateTrendChartUi();
}

function districtTitle(properties, joinInfo) {
  const abbr = String(readProperty(properties, "STUSPS") || readProperty(properties, "STATE_ABBR") || state.selectedState?.abbr || "US").trim().toUpperCase();
  const district = displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId);
  const chamberCode = state.chamber === "house" ? "HD" : "SD";
  return `${abbr} ${chamberCode}-${district}`;
}

function districtDetailHtml(properties, joinInfo, rec) {
  const title = `District ${displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId)}`;

  if (!rec) {
    return `
      <div class="detail-title detail-title-large">${escapeHtml(title)}</div>
      <div class="detail-meta-muted">No ABEV data for this district.</div>
    `;
  }

  const rows = DETAIL_STATS
    .map((stat) => {
      const totals = statTotals(rec, stat);
      if (!totals) return "";
      const selected = mapStat() === stat ? ' class="detail-row-selected"' : "";
      return `
        <tr${selected}>
          <td>${escapeHtml(STAT_LABELS[stat])}</td>
          <td>${escapeHtml(formatCount(totals.total))}</td>
          <td class="detail-cell-rep">${escapeHtml(formatCount(totals.rep))}</td>
          <td class="detail-cell-dem">${escapeHtml(formatCount(totals.dem))}</td>
          <td class="detail-cell-toss">${escapeHtml(formatCount(totals.toss))}</td>
          ${marginCellHtml(netPctFromTotals(totals))}
        </tr>
      `;
    })
    .join("");

  const voted = statTotals(rec, "voted");
  let compositionHtml = "";
  if (voted && voted.total > 0) {
    compositionHtml = stackedBreakdownHtml("Total Votes Cast by Modeled Party", [
      { label: "GOP", value: (voted.rep / voted.total) * 100, colorClass: "color-net-r" },
      { label: "Swing", value: (voted.toss / voted.total) * 100, colorClass: "color-net-toss" },
      { label: "Dem", value: (voted.dem / voted.total) * 100, colorClass: "color-net-d" },
    ], { legendColumns: 3 });
  }

  const requested = statTotals(rec, "requested");
  const returned = statTotals(rec, "returned");
  const ev = statTotals(rec, "ev");
  const rateLines = [];
  if (requested && returned && requested.total > 0) {
    rateLines.push(`AB return rate: <strong>${((returned.total / requested.total) * 100).toFixed(1)}%</strong>`);
  }
  if (voted && ev && voted.total > 0) {
    rateLines.push(`Early vote share of total: <strong>${((ev.total / voted.total) * 100).toFixed(1)}%</strong>`);
  }

  return `
    <div class="detail-title detail-title-large">${escapeHtml(title)}</div>
    ${viewCardsHtml(rec)}
    <table class="abev-detail-table">
      <thead>
        <tr><th></th><th>Total</th><th>GOP</th><th>Dem</th><th>Swing</th><th class="margin-head">Margin</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${rateLines.length ? `<div class="detail-meta">${rateLines.join("<br/>")}</div><div class="detail-break"></div>` : ""}
    ${compositionHtml}
    ${districtChronoSectionHtml(rec, joinInfo.key)}
  `;
}

// Redraw the open district panel after a chrono/history option changes. Those
// toggles sit well down the panel, so the scroll position is kept.
function rerenderSelectedDistrictDetail() {
  const layer = state.selectedDistrictLayer;
  const feature = layer?.__featureRef;
  if (!feature) return;
  const joinInfo = extractJoinIds(feature.properties);
  showDistrictDetailPanel(feature.properties, joinInfo, layer.__dataMapRef?.get(joinInfo.key), {
    preserveScroll: true,
  });
  updateTrendChartUi();
}

function districtChronoSectionHtml(rec, joinKey) {
  const byDate = chronoByDate(rec?.timeline);
  if (!byDate || !byDate.size) return "";
  const mode = state.detailChronoMode;
  const cumulative = state.detailChronoCumulative;
  const rows = buildChronoRows(byDate, mode, "Unk", cumulative);
  const button = (value, label) =>
    `<button type="button" class="detail-chrono-btn${mode === value ? " active-chrono" : ""}" data-detail-chrono="${value}">${label}</button>`;
  return `
    <div class="detail-section-title centered-section-title">${chronoModeLabel(mode, cumulative)} Returns</div>
    <div class="detail-chrono-buttons">
      ${button("daily", "Daily")}
      ${button("weekly", "Weekly")}
    </div>
    ${chronoOptionBoxesHtml(mode, cumulative, "detail-chrono-cum", joinKey)}
    ${chronoTableHtml(rows, { cumulative, joinKey })}
  `;
}

// ---------------------------------------------------------------------------
// Hover / popup content
// ---------------------------------------------------------------------------

function hoverStatTableHtml(rec) {
  const rows = DETAIL_STATS
    .map((stat) => {
      const totals = statTotals(rec, stat);
      if (!totals) return "";
      const selected = mapStat() === stat ? ' class="hover-stat-selected"' : "";
      return `
        <tr${selected}>
          <td>${escapeHtml(DETAIL_STAT_SHORT[stat])}</td>
          <td>${escapeHtml(formatCount(totals.total))}</td>
          <td>${netPctHtml(netPctFromTotals(totals))}</td>
        </tr>
      `;
    })
    .join("");
  return `<table class="hover-stat-table"><tbody>${rows}</tbody></table>`;
}

function popupHtml(properties, joinInfo, rec) {
  const title = `<div class="detail-title">${escapeHtml(districtTitle(properties, joinInfo))}</div>`;
  if (!rec) {
    return `${title}<div class="detail-meta-muted">No ABEV data.</div>`;
  }
  return `${title}${hoverStatTableHtml(rec)}`;
}

// ---------------------------------------------------------------------------
// Sidebar interactions
// ---------------------------------------------------------------------------

function wireDetailsInteractions() {
  if (state.detailsInteractionsWired) return;
  state.detailsInteractionsWired = true;

  // Schedule ⓘ tooltip: short-delay show on hover, hide on leave/scroll.
  details.addEventListener("mouseover", (event) => {
    const icon = event.target instanceof Element ? event.target.closest(".sched-info") : null;
    if (!icon) return;
    if (schedTipTimer) clearTimeout(schedTipTimer);
    schedTipTimer = setTimeout(() => showSchedTooltip(icon), 130);
  });
  details.addEventListener("mouseout", (event) => {
    const icon = event.target instanceof Element ? event.target.closest(".sched-info") : null;
    if (icon) hideSchedTooltip();
  });
  const sidebarEl = details.closest(".sidebar");
  if (sidebarEl) sidebarEl.addEventListener("scroll", hideSchedTooltip, { passive: true });

  details.addEventListener("mouseover", (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;

    // The tier button shares its row with the group's first district; hovering
    // it shouldn't highlight that district on the map.
    if (targetEl.closest(".target-tier-group-cell")) {
      setHoveredTableRow(null);
      setHoveredStateRow(null);
      return;
    }

    const districtRow = targetEl.closest(".district-select-row[data-join-key]");
    if (districtRow) {
      setHoveredStateRow(null);
      setHoveredTableRow(districtRow);
      return;
    }

    const stateRow = targetEl.closest(".state-select-row[data-state-key]");
    if (stateRow) {
      setHoveredTableRow(null);
      setHoveredStateRow(stateRow);
    }
  });

  details.addEventListener("mouseout", (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;

    const districtRow = targetEl.closest(".district-select-row[data-join-key]");
    if (districtRow) {
      const related = event.relatedTarget;
      if (related && districtRow.contains(related)) return;
      if (state.hoveredTableRowEl === districtRow) setHoveredTableRow(null);
      return;
    }

    const stateRow = targetEl.closest(".state-select-row[data-state-key]");
    if (stateRow) {
      const related = event.relatedTarget;
      if (related && stateRow.contains(related)) return;
      if (state.hoveredStateRowEl === stateRow) setHoveredStateRow(null);
    }
  });

  details.addEventListener("click", async (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;

    const viewCard = targetEl.closest(".stat-card[data-view]");
    if (viewCard) {
      setAbevView(String(viewCard.dataset.view || ""));
      return;
    }

    const natTabBtn = targetEl.closest("[data-national-tab]");
    if (natTabBtn) {
      const tab = String(natTabBtn.dataset.nationalTab || "");
      if ((tab === "overview" || tab === "schedule") && tab !== state.nationalTab) {
        state.nationalTab = tab;
        renderNationalOverview();
      }
      return;
    }

    // "Target Districts" heading toggles the whole mode; section headers and
    // tier cells narrow it.
    if (targetEl.closest("#targetModeHeader")) {
      setTargetDistrictsMode(!state.targetDistrictsMode, { preserveScroll: true });
      return;
    }

    const targetFilterEl = targetEl.closest(".target-filter-toggle[data-target-section]");
    if (targetFilterEl) {
      const section = String(targetFilterEl.dataset.targetSection || "").trim();
      const tier = districtTierValue(targetFilterEl.dataset.targetTier);
      toggleTargetFilterControl(section, tier);
      return;
    }

    const stateChronoBtn = targetEl.closest("[data-state-chrono]");
    if (stateChronoBtn) {
      const value = String(stateChronoBtn.dataset.stateChrono || "");
      if (value === "districts" || CHRONO_MODE_LABELS[value]) {
        setChronoMode(value === "districts" ? null : value);
      }
      return;
    }

    const stateChronoCumBtn = targetEl.closest("[data-state-chrono-cum]");
    if (stateChronoCumBtn) {
      const cumulative = stateChronoCumBtn.dataset.stateChronoCum === "1";
      if (state.chronoMode && cumulative !== state.chronoCumulative) {
        state.chronoCumulative = cumulative;
        showChronoView({ preserveScroll: true });
        updateTrendChartUi();
      }
      return;
    }

    const historyModeBtn = targetEl.closest("[data-history-mode]");
    if (historyModeBtn) {
      const mode = String(historyModeBtn.dataset.historyMode || "");
      if ((mode === "none" || mode === "onthisday" || mode === "final") && mode !== state.historyMode) {
        state.historyMode = mode;
        // The box now appears in all three panels; redraw whichever is showing.
        if (state.selectedDistrictLayer) rerenderSelectedDistrictDetail();
        else if (state.chronoMode) showChronoView({ preserveScroll: true });
        else showStateChamberOverview({ preserveScroll: true }); // toggle sits above a long table
        updateTrendChartUi();
      }
      return;
    }

    const detailChronoCumBtn = targetEl.closest("[data-detail-chrono-cum]");
    if (detailChronoCumBtn) {
      const cumulative = detailChronoCumBtn.dataset.detailChronoCum === "1";
      if (cumulative !== state.detailChronoCumulative) {
        state.detailChronoCumulative = cumulative;
        rerenderSelectedDistrictDetail();
      }
      return;
    }

    const detailChronoBtn = targetEl.closest("[data-detail-chrono]");
    if (detailChronoBtn) {
      const mode = String(detailChronoBtn.dataset.detailChrono || "");
      if (CHRONO_MODE_LABELS[mode] && mode !== state.detailChronoMode) {
        state.detailChronoMode = mode;
        rerenderSelectedDistrictDetail();
      }
      return;
    }

    const sortHeader = targetEl.closest("th.abev-sortable[data-sort-key]");
    if (sortHeader) {
      const key = String(sortHeader.dataset.sortKey || "").trim();
      const scope = String(sortHeader.dataset.sortScope || "").trim();
      if (key && scope === "national" && state.mode === "national") {
        setHoveredStateRow(null);
        toggleSort(state.nationalSort, key);
        details.innerHTML = nationalOverviewHtml();
      }
      if (key && scope === "district" && state.mode === "state") {
        setHoveredTableRow(null);
        toggleSort(state.districtSort, key);
        details.innerHTML = stateChamberOverviewHtml();
      }
      return;
    }

    const districtRow = targetEl.closest(".district-select-row[data-join-key]");
    if (districtRow) {
      selectDistrictFromTableRow(districtRow.dataset.joinKey || "");
      return;
    }

    const stateRow = targetEl.closest(".state-select-row[data-state-key]");
    if (stateRow) {
      await selectStateByKey(stateRow.dataset.stateKey || "");
    }
  });
}

// ---------------------------------------------------------------------------
// District number labels (ported from District Explorer)
// ---------------------------------------------------------------------------

function scheduleDistrictNumberLayerBuild(features) {
  state.districtNumberBuildToken += 1;
  const token = state.districtNumberBuildToken;
  requestAnimationFrame(() => {
    if (token !== state.districtNumberBuildToken) return;
    buildDistrictNumberLayer(features);
  });
}

function buildDistrictNumberLayer(features) {
  clearDistrictNumberLayer();
  const group = L.layerGroup();
  for (const feature of features || []) {
    const joinInfo = extractJoinIds(feature.properties);
    const districtNumber = displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId);
    if (!districtNumber) continue;
    // Filtered-out districts are dimmed; don't label them either.
    if (!districtPassesActiveFilters(joinInfo.key)) continue;
    const bounds = geometryBounds(feature.geometry);
    if (!bounds.isValid()) continue;
    const marker = L.marker(bounds.getCenter(), {
      pane: "districtNumberPane",
      interactive: false,
      icon: L.divIcon({
        className: "district-number-label-wrap",
        html: "",
      }),
    });
    marker.__districtBounds = bounds;
    marker.__districtText = districtNumber;
    marker.__districtGeometry = feature.geometry || null;
    marker.__districtLabelHtml = null;
    marker.__districtLabelLatLng = null;
    marker.addTo(group);
  }
  state.districtNumberLayer = group.addTo(map);
  refreshDistrictNumberLabels();
}

function geometryBounds(geometry) {
  if (!geometry || !geometry.type) return L.latLngBounds([]);
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  const consumeCoord = (coord) => {
    if (!Array.isArray(coord) || coord.length < 2) return;
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  };

  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
      consumeCoord(coords);
      return;
    }
    for (const child of coords) walk(child);
  };

  walk(geometry.coordinates);
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng) || !Number.isFinite(maxLat) || !Number.isFinite(maxLng)) {
    return L.latLngBounds([]);
  }
  return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
}

function clearDistrictNumberLayer() {
  state.districtNumberBuildToken += 1;
  state.districtLabelRefreshToken += 1;
  if (!state.districtNumberLayer) return;
  if (map.hasLayer(state.districtNumberLayer)) map.removeLayer(state.districtNumberLayer);
  state.districtNumberLayer = null;
}

function refreshDistrictNumberLabels() {
  if (!state.districtNumberLayer) return;
  state.districtLabelRefreshToken += 1;
  const token = state.districtLabelRefreshToken;
  const zoom = map.getZoom();
  const viewBounds = map.getBounds().pad(0.06);
  const markers = [];
  state.districtNumberLayer.eachLayer((marker) => markers.push(marker));

  const chunkSize = 20;
  const processChunk = (startIdx) => {
    if (token !== state.districtLabelRefreshToken) return;
    const endIdx = Math.min(markers.length, startIdx + chunkSize);
    for (let i = startIdx; i < endIdx; i += 1) {
      refreshDistrictNumberMarker(markers[i], zoom, viewBounds);
    }
    if (endIdx < markers.length) {
      requestAnimationFrame(() => processChunk(endIdx));
    }
  };

  processChunk(0);
}

function refreshDistrictNumberMarker(marker, zoom, viewBounds) {
  const bounds = marker.__districtBounds;
  const text = String(marker.__districtText || "");
  const geometry = marker.__districtGeometry;
  if (!bounds || !bounds.isValid() || !text || !geometry) return;
  if (viewBounds && !viewBounds.intersects(bounds)) {
    setDistrictNumberMarkerLabel(marker, "", null);
    return;
  }

  const nw = map.latLngToContainerPoint(bounds.getNorthWest());
  const se = map.latLngToContainerPoint(bounds.getSouthEast());
  const width = Math.max(0, Math.abs(se.x - nw.x));
  const height = Math.max(0, Math.abs(se.y - nw.y));
  const minWidthNeeded = Math.max(10, text.length * 6.2);
  const centerPt = map.latLngToContainerPoint(bounds.getCenter());
  const visible = width >= minWidthNeeded && height >= 10;

  if (!visible) {
    setDistrictNumberMarkerLabel(marker, "", null);
    return;
  }

  const byWidth = width / Math.max(1, text.length * 0.82);
  const byHeight = height * 0.72;
  const startSize = Math.max(11, Math.min(22, Math.min(byWidth, byHeight)));
  if (marker.__pixelGeomZoom !== zoom || !marker.__pixelGeometry) {
    marker.__pixelGeometry = buildGeometryPixelCache(geometry);
    marker.__pixelGeomZoom = zoom;
  }
  const pixelGeometry = marker.__pixelGeometry;
  const bestPlacement = findBestLabelPlacement(text, pixelGeometry, startSize, centerPt, nw, se);
  if (!bestPlacement) {
    setDistrictNumberMarkerLabel(marker, "", null);
    return;
  }

  const latlng = map.containerPointToLatLng([bestPlacement.x, bestPlacement.y]);
  const html = `<span class="district-number-label" style="font-size:${bestPlacement.size.toFixed(1)}px;">${escapeHtml(text)}</span>`;
  setDistrictNumberMarkerLabel(marker, html, latlng);
}

function setDistrictNumberMarkerLabel(marker, html, latlng) {
  const nextHtml = String(html || "");
  const currentHtml = String(marker.__districtLabelHtml || "");
  const currentLatLng = marker.__districtLabelLatLng || null;
  const needsLatLngUpdate = Boolean(
    latlng &&
      (!currentLatLng ||
        Math.abs(currentLatLng.lat - latlng.lat) > 1e-7 ||
        Math.abs(currentLatLng.lng - latlng.lng) > 1e-7)
  );

  if (nextHtml !== currentHtml) {
    marker.setIcon(
      L.divIcon({
        className: "district-number-label-wrap",
        html: nextHtml,
      })
    );
    marker.__districtLabelHtml = nextHtml;
  }
  if (latlng && needsLatLngUpdate) {
    marker.setLatLng(latlng);
    marker.__districtLabelLatLng = latlng;
  }
  if (!latlng) {
    marker.__districtLabelLatLng = null;
  }
}

function fitLabelSizeInsideFeature(text, centerPt, geometry, startSize) {
  for (let size = startSize; size >= 10.5; size -= 0.5) {
    if (labelFitsFeature(text, centerPt, geometry, size)) return size;
  }
  return null;
}

function findBestLabelPlacement(text, geometry, startSize, centerPt, nw, se) {
  const candidates = [];
  const near = searchPlacementGrid(centerPt, geometry, Math.abs(se.x - nw.x), Math.abs(se.y - nw.y), 0.65, true);
  if (near && near.length) candidates.push(...near);
  const broad = searchPlacementBounds(centerPt, geometry, nw, se, true);
  if (broad && broad.length) candidates.push(...broad);

  if (!candidates.length) return null;
  // Deduplicate and cap checked points to avoid UI freeze on state load.
  const uniq = [];
  const seen = new Set();
  for (const p of candidates) {
    const key = `${Math.round(p.x)}|${Math.round(p.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
    if (uniq.length >= 40) break;
  }

  let best = null;
  for (const p of uniq) {
    const size = fitLabelSizeInsideFeature(text, p, geometry, startSize);
    if (!size) continue;
    if (size >= startSize - 0.4) return { ...p, size };
    if (!best || size > best.size || (Math.abs(size - best.size) < 0.01 && p.dist2 < best.dist2)) {
      best = { ...p, size };
    }
  }
  return best;
}

function searchPlacementGrid(centerPt, geometry, width, height, spread, returnAll = false) {
  const xStep = Math.max(2, width * 0.18 * spread);
  const yStep = Math.max(2, height * 0.18 * spread);
  const points = [];
  for (let ix = -2; ix <= 2; ix += 1) {
    for (let iy = -2; iy <= 2; iy += 1) {
      const x = centerPt.x + ix * xStep;
      const y = centerPt.y + iy * yStep;
      const dist2 = ix * ix + iy * iy;
      points.push({ x, y, dist2 });
    }
  }
  points.sort((a, b) => a.dist2 - b.dist2);
  if (returnAll) {
    return points.filter((p) => isPointInFeaturePixels(p, geometry)).map((p) => ({ x: p.x, y: p.y, dist2: p.dist2 }));
  }
  for (const p of points) {
    if (isPointInFeaturePixels(p, geometry)) return { x: p.x, y: p.y };
  }
  return null;
}

function searchPlacementBounds(centerPt, geometry, nw, se, returnAll = false) {
  const minX = Math.min(nw.x, se.x);
  const maxX = Math.max(nw.x, se.x);
  const minY = Math.min(nw.y, se.y);
  const maxY = Math.max(nw.y, se.y);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 2 || height < 2) return null;

  const cols = 6;
  const rows = 6;
  let best = null;
  const valid = [];

  for (let cx = 0; cx <= cols; cx += 1) {
    const x = minX + (width * cx) / cols;
    for (let cy = 0; cy <= rows; cy += 1) {
      const y = minY + (height * cy) / rows;
      const pt = { x, y };
      if (!isPointInFeaturePixels(pt, geometry)) continue;
      const dx = x - centerPt.x;
      const dy = y - centerPt.y;
      const dist2 = dx * dx + dy * dy;
      valid.push({ x, y, dist2 });
      if (!best || dist2 < best.dist2) best = { x, y, dist2 };
    }
  }

  if (returnAll) {
    valid.sort((a, b) => a.dist2 - b.dist2);
    return valid;
  }
  return best ? { x: best.x, y: best.y } : null;
}

function labelFitsFeature(text, centerPt, geometry, fontSize) {
  const width = text.length * fontSize * 0.56 + 2;
  const height = fontSize * 0.9;
  const x0 = centerPt.x - width / 2;
  const x1 = centerPt.x + width / 2;
  const y0 = centerPt.y - height / 2;
  const y1 = centerPt.y + height / 2;
  const insetX = (x1 - x0) * 0.45;
  const insetY = (y1 - y0) * 0.45;

  const sample = [
    { x: centerPt.x, y: centerPt.y },
    { x: centerPt.x - insetX, y: centerPt.y },
    { x: centerPt.x + insetX, y: centerPt.y },
    { x: centerPt.x, y: centerPt.y - insetY },
    { x: centerPt.x, y: centerPt.y + insetY },
  ];

  return sample.every((pt) => isPointInFeaturePixels(pt, geometry));
}

function isPointInFeaturePixels(pt, geometry) {
  if (!geometry) return false;

  if (geometry.__pixelPolygons) {
    return geometry.__pixelPolygons.some((poly) => isPointInPolygonPixels(pt, poly));
  }

  if (!geometry.type) return false;

  if (geometry.type === "Polygon") {
    return isPointInPolygonPixels(pt, geometry.coordinates || []);
  }
  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates || [];
    return polys.some((poly) => isPointInPolygonPixels(pt, poly || []));
  }
  return false;
}

function isPointInPolygonPixels(pt, polygonCoords) {
  // Cached polygon format
  if (polygonCoords.outer && Array.isArray(polygonCoords.outer)) {
    const outer = polygonCoords.outer;
    if (outer.length < 3 || !pointInRing(pt, outer)) return false;
    const holes = polygonCoords.holes || [];
    for (const hole of holes) {
      if (hole.length >= 3 && pointInRing(pt, hole)) return false;
    }
    return true;
  }

  if (!Array.isArray(polygonCoords) || polygonCoords.length === 0) return false;

  const outer = toPixelRing(polygonCoords[0]);
  if (outer.length < 3 || !pointInRing(pt, outer)) return false;

  for (let i = 1; i < polygonCoords.length; i += 1) {
    const hole = toPixelRing(polygonCoords[i]);
    if (hole.length >= 3 && pointInRing(pt, hole)) return false;
  }
  return true;
}

function toPixelRing(coordRing) {
  if (!Array.isArray(coordRing)) return [];
  const out = [];
  for (const c of coordRing) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const p = map.latLngToContainerPoint([c[1], c[0]]);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

function buildGeometryPixelCache(geometry) {
  if (!geometry || !geometry.type) return geometry;
  const out = { __pixelPolygons: [] };

  if (geometry.type === "Polygon") {
    const p = polygonToPixelStructure(geometry.coordinates || []);
    if (p) out.__pixelPolygons.push(p);
    return out;
  }
  if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates || []) {
      const p = polygonToPixelStructure(poly || []);
      if (p) out.__pixelPolygons.push(p);
    }
    return out;
  }
  return geometry;
}

function polygonToPixelStructure(coords) {
  if (!Array.isArray(coords) || !coords.length) return null;
  const outer = toPixelRing(coords[0]);
  if (outer.length < 3) return null;
  const holes = [];
  for (let i = 1; i < coords.length; i += 1) {
    const hole = toPixelRing(coords[i]);
    if (hole.length >= 3) holes.push(hole);
  }
  return { outer, holes };
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Shapefile loading
// ---------------------------------------------------------------------------

async function loadUrlZipToGeojson(url) {
  try {
    const response = await fetch(withCacheBust(url));
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const parsed = await shp(arrayBuffer);
    return toFeatureCollection(parsed);
  } catch (err) {
    console.warn(`Could not load ${url}: ${err.message}`);
    return null;
  }
}

function toFeatureCollection(parsed) {
  if (!parsed) throw new Error("No geometry found.");
  if (parsed.type === "FeatureCollection") return parsed;

  if (Array.isArray(parsed)) {
    const collection = parsed.find((item) => item && item.type === "FeatureCollection");
    if (collection) return collection;
  }

  if (typeof parsed === "object") {
    for (const key of Object.keys(parsed)) {
      const maybe = parsed[key];
      if (maybe && maybe.type === "FeatureCollection") return maybe;
    }
  }

  throw new Error("Could not find a FeatureCollection in uploaded zip.");
}

// ---------------------------------------------------------------------------
// Join keys
// ---------------------------------------------------------------------------

function extractJoinIds(properties = {}) {
  const stateFips = normalizeStateFips(readProperty(properties, "STATEFP"));
  const districtField = state.chamber === "house" ? "SLDLST" : "SLDUST";
  const rawDistrict = readProperty(properties, districtField);
  const districtId = normalizeDistrictId(rawDistrict);
  return {
    stateFips,
    rawDistrict,
    districtId,
    key: makeJoinKey(stateFips, districtId),
  };
}

function makeJoinKey(stateFips, districtId) {
  return `${stateFips || ""}|${districtId || ""}`;
}

function normalizeStateFips(value) {
  const digits = String(value ?? "").trim().replace(/[^0-9]/g, "");
  return digits ? digits.padStart(2, "0") : "";
}

function normalizeDistrictId(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  if (/^[0-9]+$/.test(raw)) return raw.padStart(3, "0");
  return raw.replace(/\s+/g, "");
}

function displayDistrictId(rawDistrict, fallbackDistrictId) {
  const raw = String(rawDistrict ?? "").trim();
  const source = raw || String(fallbackDistrictId ?? "").trim();
  if (!source) return "";
  if (/^[0-9]+$/.test(source)) return String(Number(source));
  return source;
}

// ---------------------------------------------------------------------------
// Stacked chart (ported from District Explorer)
// ---------------------------------------------------------------------------

function widthPct(value) {
  if (typeof value !== "number") return "0%";
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped}%`;
}

function safePct(value) {
  return typeof value === "number" ? value : 0;
}

function clampPct(value) {
  if (typeof value !== "number") return 0;
  return Math.max(0, Math.min(100, value));
}

function shortPct(value) {
  return `${Math.round(safePct(value))}%`;
}

function barPct(value) {
  return `${Math.round(safePct(value))}%`;
}

function stackedBreakdownHtml(title, items, options = {}) {
  const cleaned = items.map((item) => ({
    ...item,
    value: clampPct(safePct(item.value)),
  }));

  const chartItems = cleaned.filter((item) => item.value > 0.01);
  const segmentFormatter = options.segmentFormatter || barPct;

  const segments = chartItems
    .map((item) => {
      const showLabel = item.value >= 6.3;
      return `
        <div class="stacked-segment ${item.colorClass}" style="width:${widthPct(item.value)}">
          ${showLabel ? `<span class="stacked-segment-label">${escapeHtml(segmentFormatter(item.value))}</span>` : ""}
        </div>
      `;
    })
    .join("");

  const legendColumns = Math.max(1, Math.min(3, Number(options.legendColumns) || 2));
  const legendClass = legendColumns === 3 ? "three-col" : "two-col";
  const legendRows = Math.ceil(cleaned.length / legendColumns);
  const legend = cleaned
    .map(
      (item) => `
      <div class="stacked-legend-item">
        <span class="stacked-swatch ${item.colorClass}"></span>
        <span>${escapeHtml(item.label)}: ${escapeHtml(shortPct(item.value))}</span>
      </div>
    `
    )
    .join("");
  const showLegend = options.showLegend !== false;
  const headerClass = options.headerClass || "chart-header";

  return `
    <div class="detail-subtitle centered-subtitle ${headerClass}">${title}</div>
    <div class="stacked-chart">${segments}</div>
    ${showLegend ? `<div class="stacked-legend ${legendClass}" style="--legend-rows:${legendRows};">${legend}</div>` : ""}
    <div class="detail-break"></div>
  `;
}

// ---------------------------------------------------------------------------
// Misc utilities
// ---------------------------------------------------------------------------

function readProperty(properties, key) {
  if (!key || !properties) return "";
  return properties[key] ?? properties[key.toUpperCase()] ?? properties[key.toLowerCase()] ?? "";
}

function interpolateHex(lightHex, darkHex, t) {
  const a = hexToRgb(lightHex);
  const b = hexToRgb(darkHex);
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(a.r + (b.r - a.r) * clamped);
  const g = Math.round(a.g + (b.g - a.g) * clamped);
  const bVal = Math.round(a.b + (b.b - a.b) * clamped);
  return rgbToHex(r, g, bVal);
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(n) {
  return n.toString(16).padStart(2, "0");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setStatus(msg) {
  if (statusText) statusText.textContent = msg;
}
