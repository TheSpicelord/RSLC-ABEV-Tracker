export const state = {
  mode: "national",
  chamber: "house",
  abevView: "abev",
  // National sidebar tab: "overview" (stat table) | "schedule" (ABEV windows).
  nationalTab: "overview",
  // Chrono granularity ("daily" | "weekly"; null statewide = plain district
  // table). Day-to-day vs running totals is a separate A/B beneath it.
  chronoMode: null,
  chronoCumulative: false,
  detailChronoMode: "daily",
  // State sidebar's Counties view (ABEV pace vs the 2024 presidential margin).
  countyView: false,
  countySort: { key: null, direction: 0 },
  // County data (county_totals.json / county_pres_2024.json), loaded on first use.
  countyDataLoaded: false,
  countyDataPromise: null,
  countyTotals: new Map(),
  countyPres: new Map(),
  detailChronoCumulative: false,
  selectedState: null,

  // Geometry
  statesGeojson: null,
  statesLayer: null,
  statesByKey: new Map(),
  stateBoundsByKey: new Map(),
  stateLayerByKey: new Map(),
  geojsonByChamber: {
    house: null,
    senate: null,
    county: null,
  },
  districtFeaturesByChamberState: {
    house: new Map(),
    senate: new Map(),
    county: new Map(),
  },
  nhFloterialGeojson: null,

  // ABEV data
  dataByChamber: {
    house: new Map(),
    senate: new Map(),
    // Filled per state on demand (ensureCountyChamberData).
    county: new Map(),
  },
  countyFileIndex: [],
  countyShapesPromise: null,
  countyChamberLoaded: new Set(),
  nationalByFips: new Map(),
  timelineByFips: new Map(),
  chamberNamesByState: new Map(),
  updatedDate: "",
  refreshedAt: "", // national.json refreshed_at: when daily_update.py last ran
  isSampleData: false,

  // District Explorer data (targets / incumbents / past leg margins), lazily
  // fetched per "ABBR|chamber" and cached. Values are Map(joinKey -> record).
  deDataByKey: new Map(),
  deChamberIndex: null, // abbr|chamber -> DE file name, from chamber_files.json

  // Past-cycle ABEV (2022 / 2024). historyByKey: "year|ABBR|chamber" -> Map(joinKey -> record).
  historyIndex: null,
  historyByKey: new Map(),
  // Statewide past-cycle timelines: year -> Map(fips -> {requested,returned,ev}).
  // One file per year covering every backfilled state, so it loads once.
  historyTimelineByYear: new Map(),
  historyTimelinesLoaded: false,
  historyMode: "none", // "none" | "onthisday" | "final"
  deBaseUrl: null, // first DE_DATA_BASES entry that answered, reused thereafter

  // Target-district + Up-in-2026 filtering
  targetDistrictsMode: false,
  upIn2026Mode: false,
  targetFilters: null,
  targetJoinKeySet: new Set(),
  upIn2026JoinKeySet: new Set(),
  filteredDistrictJoinKeySet: null,

  // Layers / rendering
  districtLayer: null,
  districtLayerIndex: new Map(),
  floterialLayer: null,
  floterialLayerByJoinKey: new Map(),
  currentDistrictFeatures: [],
  districtNumberLayer: null,
  districtNumberBuildToken: 0,
  districtLabelRefreshToken: 0,
  selectedDistrictLayer: null,
  selectedDistrictOutlineLayer: null,
  hoverDistrictLayer: null,
  hoverInfoEl: null,
  chamberOverviewBtnEl: null,
  trendTabEl: null,
  trendPanelEl: null,
  trendChartOpen: false,
  trendChartEndAtToday: false,
  // Which cycles the trend graph draws. Past years are only offered where the
  // scope actually has a backfill.
  trendYears: { 2022: false, 2024: false, 2025: false, 2026: true },
  hasOpenPopup: false,
  suspendPopupCloseOverview: false,

  // Sidebar interactions
  detailsInteractionsWired: false,
  hoveredTableRowEl: null,
  hoveredStateRowEl: null,
  hoveredStateKey: null,
  hoveredStateOverlayLayer: null,
  nationalSort: { key: null, direction: 0 },
  districtSort: { key: null, direction: 0 },
  detailsRenderToken: 0,
};
