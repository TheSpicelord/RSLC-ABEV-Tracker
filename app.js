import { requireAuth } from "./modules/auth.js";
import {
  ABEV_INDEX_URL,
  ABEV_NATIONAL_URL,
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
  cumulativeChronoBtn,
  dailyChronoBtn,
  details,
  detailsTitle,
  exitStateBtn,
  houseChamberBtn,
  sampleBadge,
  senateChamberBtn,
  stateSelect,
  statusText,
  statViewButtons,
  updatedBadge,
} from "./modules/dom.js";
import { state } from "./modules/state.js";

if (AUTH_ENABLED) {
  await requireAuth(AUTH_WORKER_URL);
}

const BUILD_VERSION = "20260718c";

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
function marginCellHtml(netPct) {
  if (typeof netPct !== "number") {
    return '<td class="margin-cell margin-cell-na">N/A</td>';
  }
  const sign = netPct >= 0 ? "+" : "-";
  const text = `${sign}${Math.abs(netPct).toFixed(1)}`;
  return `<td class="margin-cell" style="background:${netColor(netPct)}">${escapeHtml(text)}</td>`;
}

// The stat used for map coloring / highlights under the active view.
function mapStat() {
  return VIEW_MAP_STAT[state.abevView] || "voted";
}

// Fill color from net advantage as a share of the stat total.
// Red = GOP advantage, blue = Dem advantage (note: reversed sign convention
// from District Explorer, which stores Dem-positive margins).
function netColor(netPct) {
  if (typeof netPct !== "number") return "#d5dae0";
  if (Math.abs(netPct) < 0.0001) return "#f0f2f5";
  if (netPct > 0) return interpolateHex("#ffd4dc", "#F82644", Math.min(netPct, 40) / 40);
  return interpolateHex("#cfe2ff", "#257BF8", Math.min(Math.abs(netPct), 40) / 40);
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
// Events
// ---------------------------------------------------------------------------

function wireEvents() {
  houseChamberBtn.addEventListener("click", async () => {
    await setChamber("house");
  });

  senateChamberBtn.addEventListener("click", async () => {
    await setChamber("senate");
  });

  if (dailyChronoBtn) {
    dailyChronoBtn.addEventListener("click", () => {
      setChronoMode("daily");
    });
  }

  if (cumulativeChronoBtn) {
    cumulativeChronoBtn.addEventListener("click", () => {
      setChronoMode("cumulative");
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

function showActiveStateSidebar() {
  if (state.chronoMode) {
    showChronoView();
  } else {
    showStateChamberOverview();
  }
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

  await ensureDistrictShapesLoaded();
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
  const inChrono = inState && !!state.chronoMode;
  houseChamberBtn.disabled = !inState;
  senateChamberBtn.disabled = !inState;
  if (dailyChronoBtn) dailyChronoBtn.disabled = !inState;
  if (cumulativeChronoBtn) cumulativeChronoBtn.disabled = !inState;
  exitStateBtn.hidden = !inState;
  houseChamberBtn.classList.toggle("active-chamber", inState && !inChrono && state.chamber === "house");
  senateChamberBtn.classList.toggle("active-chamber", inState && !inChrono && state.chamber === "senate");
  if (dailyChronoBtn) dailyChronoBtn.classList.toggle("active-chrono", inChrono && state.chronoMode === "daily");
  if (cumulativeChronoBtn) cumulativeChronoBtn.classList.toggle("active-chrono", inChrono && state.chronoMode === "cumulative");
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
    await ensureDistrictShapesLoaded();
    renderDistrictLayerForSelectedState();
    refreshStateBoundaryStyles();
  }
}

function setChronoMode(mode) {
  if (mode !== "daily" && mode !== "cumulative" && mode !== null) return;
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
    details.innerHTML = "Switch to Upper Chamber to view Nebraska's unicameral legislature.";
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

function nationalOverviewHtml() {
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
    return `${name} — ${state.chronoMode === "daily" ? "Daily" : "Cumulative"}`;
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
  const statewideRec = state.nationalByFips.get(fips) || null;

  const cards = ABEV_VIEWS
    .map((view) => {
      const stat = VIEW_MAP_STAT[view];
      const totals = statewideRec ? statTotals(statewideRec, stat) : null;
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

// Column layouts per view. "gap" entries render as thin separator columns.
function viewColumnDefs(view) {
  if (view === "ab") {
    return [
      { type: "gap" },
      { key: "requested", kind: "count", label: "Requested", sortKey: "requested" },
      { key: "requested", kind: "margin", label: "Requested Margin", sortKey: "requested_margin" },
      { type: "gap" },
      { key: "returned", kind: "count", label: "Returned", sortKey: "returned" },
      { key: "returned", kind: "margin", label: "Returned Margin", sortKey: "returned_margin" },
    ];
  }
  if (view === "ev") {
    return [
      { type: "gap" },
      { key: "ev", kind: "count", label: "Early Votes", sortKey: "ev" },
      { key: "ev", kind: "margin", label: "Early Votes Margin", sortKey: "ev_margin" },
    ];
  }
  return [
    { type: "gap" },
    { key: "returned", kind: "count", label: "Absentees Returned", sortKey: "returned" },
    { key: "ev", kind: "count", label: "Early Votes", sortKey: "ev" },
    { type: "gap" },
    { key: "voted", kind: "count", label: "Total Votes", sortKey: "voted" },
    { key: "voted", kind: "margin", label: "ABEV Margin", sortKey: "voted_margin" },
  ];
}

function districtTableHtml() {
  const rows = districtRowsForSelectedState();
  if (!rows.length) {
    return '<div class="loading-indicator">No district-level ABEV data for this chamber.</div>';
  }
  const cols = viewColumnDefs(state.abevView);

  const headCells = cols
    .map((col) => {
      if (col.type === "gap") return '<th class="abev-gap-cell"></th>';
      return `<th class="abev-sortable" data-sort-scope="district" data-sort-key="${col.sortKey}">${escapeHtml(col.label)}${sortIndicator(state.districtSort, col.sortKey)}</th>`;
    })
    .join("");

  const body = rows
    .map((row) => {
      const cells = cols
        .map((col) => {
          if (col.type === "gap") return '<td class="abev-gap-cell"></td>';
          const totals = row.rec ? statTotals(row.rec, col.key) : null;
          if (col.kind === "count") {
            return `<td class="abev-count-cell">${totals ? escapeHtml(formatCount(totals.total)) : "—"}</td>`;
          }
          return marginCellHtml(netPctFromTotals(totals));
        })
        .join("");
      return `
        <tr class="target-row district-select-row" data-join-key="${escapeHtml(row.joinKey)}">
          <td class="abev-name-cell">${escapeHtml(row.label)}</td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  return `
    <table class="abev-table">
      <thead>
        <tr>
          <th class="abev-sortable abev-name-head" data-sort-scope="district" data-sort-key="district">Dist${sortIndicator(state.districtSort, "district")}</th>
          ${headCells}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function stateChamberOverviewHtml() {
  return `
    ${statewideCardsHtml()}
    <div class="detail-break"></div>
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
// Sidebar: chronological views (Daily / Cumulative)
// ---------------------------------------------------------------------------

const CHRONO_STATS = ["requested", "returned", "ev"];

function showChronoView() {
  if (state.mode !== "state" || !state.selectedState || !state.chronoMode) return;
  state.detailsRenderToken += 1;
  const renderToken = state.detailsRenderToken;
  detailsTitle.textContent = selectedStateChamberHeader();
  requestAnimationFrame(() => {
    if (state.mode !== "state" || !state.chronoMode || renderToken !== state.detailsRenderToken) return;
    details.innerHTML = chronoViewHtml();
    wireDetailsInteractions();
    resetSidebarScroll();
  });
}

function chronoViewHtml() {
  const title = state.chronoMode === "daily" ? "Daily Activity" : "Cumulative Totals";
  return `
    ${statewideCardsHtml()}
    <div class="detail-break"></div>
    <div class="detail-section-title centered-section-title">${escapeHtml(title)}</div>
    ${chronoTableHtml()}
  `;
}

function timelineEntriesForSelectedState() {
  const fips = normalizeStateFips(state.selectedState?.fips);
  const rec = state.timelineByFips.get(fips);
  if (!rec) return null;
  // dateKey -> { requested: {rep,dem,toss}, returned: {...}, ev: {...} }
  const byDate = new Map();
  for (const stat of CHRONO_STATS) {
    for (const row of rec[stat] || []) {
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

function chronoRows() {
  const byDate = timelineEntriesForSelectedState();
  if (!byDate || !byDate.size) return [];
  const todayIso = new Date().toISOString().slice(0, 10);

  const dateKeys = [];
  let pre = null;
  let unknown = null;
  for (const [key, stats] of byDate) {
    if (key === "pre2026") {
      pre = stats;
      continue;
    }
    if (key === "unknown") {
      unknown = stats;
      continue;
    }
    if (key > todayIso) continue; // never display future dates
    dateKeys.push(key);
  }
  dateKeys.sort();

  if (state.chronoMode === "daily") {
    const rows = dateKeys
      .map((key) => ({ label: chronoDateLabel(key), stats: addChronoStats(emptyChronoStats(), byDate.get(key)), special: false }))
      .reverse(); // newest first
    if (pre) rows.push({ label: "Pre-2026", stats: addChronoStats(emptyChronoStats(), pre), special: true });
    if (unknown) rows.push({ label: "Unknown", stats: addChronoStats(emptyChronoStats(), unknown), special: true });
    return rows;
  }

  // Cumulative: pre-2026 + unknown form the baseline so the newest row
  // accounts for every vote recorded to date.
  const baseline = emptyChronoStats();
  if (pre) addChronoStats(baseline, pre);
  if (unknown) addChronoStats(baseline, unknown);
  const running = addChronoStats(emptyChronoStats(), baseline);
  const rows = [];
  for (const key of dateKeys) {
    addChronoStats(running, byDate.get(key));
    rows.push({ label: chronoDateLabel(key), stats: structuredClone(running), special: false });
  }
  rows.reverse(); // newest (= all-time total) first
  if (chronoStatsHaveData(baseline)) {
    rows.push({ label: "Pre-2026 & Unk", stats: baseline, special: true });
  }
  return rows;
}

function chronoDateLabel(isoDate) {
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${Number(m[2])}/${Number(m[3])}`;
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

function chronoTableHtml() {
  const rows = chronoRows();
  if (!rows.length) {
    return '<div class="loading-indicator">No chronological ABEV data for this state.</div>';
  }
  const cols = viewColumnDefs(state.abevView);

  const headCells = cols
    .map((col) => {
      if (col.type === "gap") return '<th class="abev-gap-cell"></th>';
      return `<th>${escapeHtml(col.label)}</th>`;
    })
    .join("");

  const body = rows
    .map((row) => {
      const dataCols = cols.filter((col) => col.type !== "gap");
      const allZero = dataCols.every((col) => chronoStatTotals(row.stats, col.key).total === 0);
      if (allZero && state.chronoMode === "daily" && !row.special) return "";
      if (allZero && row.special) return "";
      const cells = cols
        .map((col) => {
          if (col.type === "gap") return '<td class="abev-gap-cell"></td>';
          const totals = chronoStatTotals(row.stats, col.key);
          if (col.kind === "count") {
            return `<td class="abev-count-cell">${escapeHtml(formatCount(totals.total))}</td>`;
          }
          const netPct = totals.total > 0 ? (totals.net / totals.total) * 100 : null;
          return marginCellHtml(netPct);
        })
        .join("");
      return `
        <tr class="target-row${row.special ? " chrono-special-row" : ""}">
          <td class="chrono-date-cell">${escapeHtml(row.label)}</td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  return `
    <table class="abev-table">
      <thead>
        <tr>
          <th class="abev-name-head">Date</th>
          ${headCells}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
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

function showDistrictDetailPanel(properties, joinInfo, rec) {
  state.detailsRenderToken += 1;
  detailsTitle.textContent = chamberDisplayName();
  details.innerHTML = districtDetailHtml(properties, joinInfo, rec);
  wireDetailsInteractions();
  resetSidebarScroll();
}

function districtTitle(properties, joinInfo) {
  const abbr = String(readProperty(properties, "STUSPS") || readProperty(properties, "STATE_ABBR") || state.selectedState?.abbr || "US").trim().toUpperCase();
  const district = displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId);
  const chamberCode = state.chamber === "house" ? "HD" : "SD";
  return `${abbr} ${chamberCode}-${district}`;
}

function districtDetailHtml(properties, joinInfo, rec) {
  const title = districtTitle(properties, joinInfo);
  const name = String(readProperty(properties, "NAMELSAD") || "").trim();

  if (!rec) {
    return `
      <div class="detail-title">${escapeHtml(title)}</div>
      ${name ? `<div class="detail-meta">${escapeHtml(name)}</div>` : ""}
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
          <td>${netPctHtml(netPctFromTotals(totals))}</td>
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
    <div class="detail-title">${escapeHtml(title)}</div>
    ${name ? `<div class="detail-meta">${escapeHtml(name)}</div>` : ""}
    ${state.updatedDate ? `<div class="detail-meta-muted">Data as of ${escapeHtml(state.updatedDate)}</div>` : ""}
    <div class="detail-break"></div>
    <table class="abev-detail-table">
      <thead>
        <tr><th></th><th>Total</th><th>GOP</th><th>Dem</th><th>Swing</th><th>Margin</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${rateLines.length ? `<div class="detail-meta">${rateLines.join("<br/>")}</div><div class="detail-break"></div>` : ""}
    ${compositionHtml}
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

  details.addEventListener("mouseover", (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;

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
