export const state = {
  mode: "national",
  chamber: "house",
  abevView: "abev",
  chronoMode: null,
  detailChronoMode: "daily",
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
  },
  districtFeaturesByChamberState: {
    house: new Map(),
    senate: new Map(),
  },
  nhFloterialGeojson: null,

  // ABEV data
  dataByChamber: {
    house: new Map(),
    senate: new Map(),
  },
  nationalByFips: new Map(),
  timelineByFips: new Map(),
  chamberNamesByState: new Map(),
  updatedDate: "",
  isSampleData: false,

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
