import { useEffect, useMemo, useRef, useState } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents
} from "react-leaflet";
import L from "leaflet";
import {
  ArrowUpRight,
  Building2,
  Info,
  Leaf,
  LoaderCircle,
  MapPin,
  Navigation,
  Search,
  ThermometerSun,
  TreePine
} from "lucide-react";

import "leaflet/dist/leaflet.css";
import "./App.css";

// Only the initial map position is fixed. Every temperature comes from the GeoJSON.
const MUMBAI_CENTER = [19.09, 72.88];
// Set VITE_API_BASE_URL to your running Python API origin (no trailing slash).
// Uses same-origin /api by default for local proxy setups.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const WARD_DATA_URL = `${import.meta.env.BASE_URL}data/mumbai_wards_latest.geojson`;

const selectedLocationIcon = L.divIcon({
  className: "selected-location-marker",
  html: '<div class="location-pin"></div>',
  iconSize: [28, 36],
  iconAnchor: [14, 34]
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function celsius(value, decimals = 1) {
  const number = finiteNumber(value);
  return number === null ? "-- °C" : `${number.toFixed(decimals)} °C`;
}

function formatDate(value) {
  if (!value) return "--";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Point-in-polygon uses GeoJSON's [longitude, latitude] coordinate order.
// The first ring is the outer boundary; remaining rings are holes.
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = (yi > lat) !== (yj > lat) &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon, lat, rings) {
  if (!rings?.length || !pointInRing(lon, lat, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(lon, lat, hole));
}

function featureAtLocation(features, lat, lon) {
  return features.find((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return false;
    if (geometry.type === "Polygon") {
      return pointInPolygon(lon, lat, geometry.coordinates);
    }
    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.some((rings) => pointInPolygon(lon, lat, rings));
    }
    return false;
  }) || null;
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

// Heat classes are relative to the 24 ward measurements for the displayed date.
// These are not official heat-risk or health thresholds.
function heatClass(value, breaks) {
  const v = finiteNumber(value);
  if (v === null || breaks.length < 2) return "unavailable";
  if (v <= breaks[0]) return "cooler";
  if (v <= breaks[1]) return "moderate";
  return "hotter";
}

const classColors = {
  cooler: "#55a88d",
  moderate: "#ebbc62",
  hotter: "#d9715f",
  unavailable: "#a5b4ad"
};

// This is a relative vegetation-index description, not a measured canopy percentage.
function greeneryDescription(ndvi) {
  const value = finiteNumber(ndvi);
  if (value === null) return {
    label: "Greenery data unavailable",
    detail: "No reliable vegetation measurement is available for this location."
  };
  if (value >= 0.5) return {
    label: "High vegetation signal",
    detail: "Satellite data indicates substantial vegetation within the sampled area."
  };
  if (value >= 0.3) return {
    label: "Moderate vegetation signal",
    detail: "Satellite data indicates a mix of vegetation and other surfaces within the sampled area."
  };
  return {
    label: "Low vegetation signal",
    detail: "Satellite data indicates relatively limited vegetation within the sampled area."
  };
}

// Ward heat classes are computed from the 24 ward means for this observation.
// They describe the containing ward, not the pixel/campus's own relative rank.
function wardHeatDescription(classification) {
  if (classification === "cooler") return {
    label: "Relatively cooler ward",
    detail: "This location is in a ward with a lower average surface temperature than many other Mumbai wards."
  };
  if (classification === "moderate") return {
    label: "Moderate ward heat level",
    detail: "The surrounding ward's average surface temperature falls in the middle range for Mumbai."
  };
  if (classification === "hotter") return {
    label: "Relatively hotter ward",
    detail: "This location is in a ward with a higher average surface temperature than many other Mumbai wards."
  };
  return {
    label: "Heat comparison unavailable",
    detail: "There is not enough ward data to compare heat levels."
  };
}

function MapController({ selected, wards }) {
  const map = useMap();
  const fitted = useRef(false);

  // Use Leaflet's native scroll wheel zoom for responsive navigation.
  useEffect(() => {
    if (wards?.features?.length && !fitted.current) {
      const bounds = L.geoJSON(wards).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
        fitted.current = true;
      }
    }
  }, [map, wards]);

  useEffect(() => {
    if (selected?.position && selected.source === "search") {
      map.flyTo(selected.position, 15, { duration: 1.1 });
    }
  }, [selected, map]);

  return null;
}

function MapClickHandler({ onLocationSelect }) {
  useMapEvents({
    click(event) {
      onLocationSelect(event.latlng.lat, event.latlng.lng);
    }
  });
  return null;
}

function App() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [wards, setWards] = useState(null);
  const [wardError, setWardError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [wardForecast, setWardForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWardData() {
      try {
        const response = await fetch(WARD_DATA_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
          throw new Error("The ward file is not a valid GeoJSON FeatureCollection.");
        }
        setWards(data);
      } catch (err) {
        if (err.name !== "AbortError") {
          setWardError(`Could not load ward satellite data (${err.message}). Check public/data/mumbai_wards_latest.geojson.`);
        }
      }
    }

    loadWardData();
    return () => controller.abort();
  }, []);

  const features = wards?.features || [];
  const wardValues = useMemo(() => features
    .filter((feature) => feature.properties?.satellite_available)
    .map((feature) => finiteNumber(feature.properties?.lst_mean_c))
    .filter((value) => value !== null)
    .sort((a, b) => a - b), [wards]);

  const breaks = useMemo(() => wardValues.length
    ? [percentile(wardValues, 1 / 3), percentile(wardValues, 2 / 3)]
    : [], [wardValues]);

  const overview = useMemo(() => {
    const observed = features.filter((feature) => feature.properties?.satellite_available);
    // Unweighted average of ward means, not a pixel- or area-weighted Mumbai-wide mean.
    const mean = wardValues.length
      ? wardValues.reduce((sum, value) => sum + value, 0) / wardValues.length
      : null;
    return {
      count: observed.length,
      mean,
      date: observed.map((feature) => feature.properties?.observation_date).filter(Boolean).sort().at(-1)
    };
  }, [features, wardValues]);

  const currentWard = selected && wards
    ? featureAtLocation(features, selected.latitude, selected.longitude)
    : null;
  const props = currentWard?.properties;
  const wardAvailable = Boolean(props?.satellite_available);
  const currentClass = wardAvailable ? heatClass(props.lst_mean_c, breaks) : "unavailable";
  const heatContext = wardHeatDescription(currentClass);
  const forecastWardCode = selected && currentWard ? String(props?.ward_code || "") : "";

  useEffect(() => {
    if (!forecastWardCode) {
      setWardForecast(null);
      setForecastLoading(false);
      return;
    }
    const controller = new AbortController();
    setForecastLoading(true);
    setWardForecast(null);
    fetch(`${API_BASE_URL}/forecast-ward?ward=${encodeURIComponent(forecastWardCode)}`, {
      signal: controller.signal, headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Forecast service returned ${response.status}`);
        return response.json();
      })
      .then((data) => { if (!controller.signal.aborted) setWardForecast(data); })
      .catch(() => { if (!controller.signal.aborted) setWardForecast({ status: "unavailable" }); })
      .finally(() => { if (!controller.signal.aborted) setForecastLoading(false); });
    return () => controller.abort();
  }, [forecastWardCode]);

  function setLocation(lat, lon, name, address, source) {
    setSelected({
      name,
      address,
      latitude: lat,
      longitude: lon,
      position: [lat, lon],
      source
    });
  }

  // All real measurements, categories and recommendations come from the API.
  // Preserve the map/UI and ward display when the API is unavailable.
  // Friendly messages for visitors; never show raw HTTP or Python exception text.
  function friendlyAnalysisError(status, detail) {
    const message = String(detail || "").toLowerCase();
    if (status === 422) {
      if (message.includes("outside") || message.includes("bmc") || message.includes("boundary")) {
        return "This location is outside our Mumbai study area. Choose a location within BMC Mumbai.";
      }
      return "We couldn't identify this area accurately. Try a more specific name or select its position on the map.";
    }
    if (status === 429) return "Map search is busy right now. Please try again shortly or select a point on the map.";
    if (status === 404) return "We couldn't find that location. Try another name or select a point on the map.";
    return "We couldn't analyse this location right now. Please try again.";
  }

  async function fetchAnalysis(path, myRequest, context = "point") {
    setAnalysisLoading(true);
    setAnalysisError("");
    setError("");
    setAnalysis(null);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(friendlyAnalysisError(response.status, data.detail));
      if (myRequest !== requestId.current) return null;
      setAnalysis(data);
      return data;
    } catch (err) {
      if (myRequest === requestId.current) {
        const message = err instanceof TypeError
          ? "Can't reach the analysis service. Check the connection and try again."
          : (err.message || "We couldn't analyse this location right now. Please try again.");
        if (context === "search") setError(message);
        else setAnalysisError(message);
      }
      return null;
    } finally {
      if (myRequest === requestId.current) setAnalysisLoading(false);
    }
  }

  async function selectCoordinates(latitude, longitude, source = "map") {
    const myRequest = ++requestId.current;
    setError("");
    setLoading(true);
    const coordinateLabel = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    setLocation(latitude, longitude, `Map point · ${coordinateLabel}`, "Looking up the nearby place…", source);
    setSearch(coordinateLabel);
    const result = await fetchAnalysis(`/analyze?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`, myRequest);
    if (myRequest === requestId.current) {
      const nearby = result?.matched_location;
      const nearbyName = nearby?.name || nearby?.display_name?.split(",")[0]?.trim();
      const locationName = nearbyName ? `Near ${nearbyName}` : `Map point · ${coordinateLabel}`;
      const locationAddress = nearby?.display_name
        ? `Approximate nearby address: ${nearby.display_name}`
        : `Selected coordinates: ${coordinateLabel}`;
      setLocation(latitude, longitude, locationName, locationAddress, source);
    }
    if (myRequest === requestId.current) setLoading(false);
  }

  async function handleSearch(event) {
    event.preventDefault();
    const query = search.trim();
    if (!query) {
      setError("Enter a place name or coordinates.");
      return;
    }
    const coordinateMatch = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordinateMatch) {
      const latitude = Number(coordinateMatch[1]);
      const longitude = Number(coordinateMatch[2]);
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        setError("Please enter valid latitude and longitude.");
        return;
      }
      await selectCoordinates(latitude, longitude, "search");
      return;
    }
    const myRequest = ++requestId.current;
    setError("");
    setLoading(true);
    setSelected(null); // Don't show a previous location as if it matched the new search.
    const data = await fetchAnalysis(`/analyze-place?q=${encodeURIComponent(query)}`, myRequest, "search");
    if (myRequest === requestId.current && data?.matched_location) {
      const place = data.matched_location;
      const latitude = Number(place.latitude);
      const longitude = Number(place.longitude);
      setLocation(latitude, longitude, query, place.display_name || query, "search");
    }
    if (myRequest === requestId.current) setLoading(false);
  }

  const areaDecision = analysis?.area_analysis;
  const areaType = areaDecision?.primary_label;
  const observed = finiteNumber(analysis?.observed_lst_c);
  const areaPixelCount = analysis?.area_summary?.valid_pixel_centres;
  const isPolygon = analysis?.boundary_status === "mapped_polygon" || (analysis?.area_summary && analysis?.boundary_source);
  const spatialLabel = isPolygon
    ? `Mapped area · ${areaPixelCount ?? "multiple"} satellite pixels`
    : "One 30-metre satellite pixel";
  // The backend ranks by satellite context and land use; show up to four.
  const recommendations = (areaDecision?.interventions || []).slice(0, 4);
  // Scenario estimates are a response to a hypothetical change in ground-level
  // vegetation, not causal predictions for any individual action. Never attach
  // them to roof, pavement or tree-protection-only recommendations.
  const areaVegetationScenarios = analysis?.area_vegetation_scenarios;
  const supportedGreeningIds = new Set([
    "restore_native_vegetation", "pocket_parks", "tree_corridors",
    "park_canopy", "shade_pedestrian_routes"
  ]);
  const matchesGreeningAction = (item) => {
    if (!item) return false;
    if (supportedGreeningIds.has(item.id)) return true;
    // Compatibility with older API versions which returned a name but no ID.
    // Never infer an estimate for protection-only or roof/pavement actions.
    if (item.id) return false;
    const name = String(item.name || "").toLowerCase();
    return ["shade exposed walkways with suitable native trees", "create connected tree corridors",
      "develop pocket parks or planted courtyards", "restore native vegetation and degraded green patches",
      "diversify park vegetation with suitable tree canopy"].some((known) => name === known);
  };
  const sceneBaseline = finiteNumber(areaVegetationScenarios?.spring_observed_area_lst_c);
  const areaModelScenarios = (areaVegetationScenarios?.scenarios || [])
    .map((scenario) => {
      const change = finiteNumber(scenario?.site_averaged_model_anomaly_change_c);
      const vegetationChange = finiteNumber(scenario?.ndvi_increase);
      // The older backend returned a model response but did not yet provide
      // conditional_after_lst_c; use the SAME spring scene baseline only.
      const reportedAfter = finiteNumber(scenario?.conditional_after_lst_c);
      const after = reportedAfter !== null ? reportedAfter
        : (sceneBaseline !== null && change !== null ? sceneBaseline + change : null);
      return { ...scenario, temperatureChange: change, vegetationChange, after };
    })
    .filter((scenario) => scenario.temperatureChange !== null && scenario.vegetationChange !== null && scenario.temperatureChange < 0);
  const preferredGreeningScenario = [...areaModelScenarios].sort(
    (a, b) => Math.abs(a.vegetationChange - 0.1) - Math.abs(b.vegetationChange - 0.1)
  )[0] || null;
  // Show the estimates on one suitable, already-recommended ground-greening card.
  const greeningCardIndex = preferredGreeningScenario
    ? recommendations.findIndex(matchesGreeningAction) : -1;
  const postScenarioTemperatures = areaModelScenarios.map((item) => item.after).filter((v) => v !== null);
  const lowestGreeningTemp = postScenarioTemperatures.length ? Math.min(...postScenarioTemperatures) : null;
  const highestGreeningTemp = postScenarioTemperatures.length ? Math.max(...postScenarioTemperatures) : null;

  // Data-driven, subtle, non-interactive heat overlay.
  // It never captures mouse movement or clicks: the original map click handler
  // remains responsible for selecting any location.
  function styleFeature(feature) {
    const value = feature.properties?.satellite_available
      ? feature.properties?.lst_mean_c
      : null;
    const classification = heatClass(value, breaks);
    return {
      color: "#668376",
      weight: 0.65,
      opacity: 0.34,
      fillColor: classColors[classification],
      fillOpacity: 0.17
    };
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon"><ThermometerSun size={27} /></div>
          <div><h2>URBAN HEAT</h2><p>MUMBAI HEAT MITIGATION PLANNER</p></div>
        </div>
        <div className="region-label"><MapPin size={19} /> Greater Mumbai · 24 BMC wards</div>
      </header>

      <main className="main-content">
        <section className="intro">
          <p className="eyebrow">MUMBAI URBAN HEAT MITIGATION</p>
          <h1>Discover solutions.</h1>
          <div className="city-summary">
            <ThermometerSun size={17} />
            <span><strong>{celsius(overview.mean)}</strong> average of {overview.count} ward mean surface temperatures</span>
            <span className="city-summary-date">Landsat: {formatDate(overview.date)}</span>
          </div>
          {wardError && <p className="error-message">{wardError}</p>}
        </section>

        <section className="search-section">
          <h2>Find a location</h2>
          <p>Search by landmark, neighbourhood or latitude, longitude. Ward statistics are not precise measurements of the searched place.</p>
          <form className="search-box" onSubmit={handleSearch}>
            <Search size={23} />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Try Marol, Powai, SGNP or 19.135, 72.875..."
              aria-label="Search Mumbai location"
            />
            <button type="submit" disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={19} /> : <>Explore <ArrowUpRight size={18} /></>}
            </button>
          </form>
          {error && <p className="error-message search-feedback" role="alert">{error}</p>}
        </section>

        <section className="results-layout">
          <div className="map-column">
            <div className="map-card">
            <div className="card-heading">
              <div>
                <h2>Explore Mumbai</h2>
                <p>Click anywhere on the map or search for a location</p>
              </div>
              <span className="live-label"><span className="live-dot"></span> SATELLITE DATA</span>
            </div>
            <div className="map-wrapper">
              <MapContainer
                center={MUMBAI_CENTER}
                zoom={11}
                minZoom={9}
                maxZoom={19}
                scrollWheelZoom={true}
                touchZoom={true}
                className="mumbai-map"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickHandler onLocationSelect={(lat, lon) => selectCoordinates(lat, lon, "map")} />
                <MapController selected={selected} wards={wards} />
                {wards && (
                  <GeoJSON
                    key={overview.date || "ward-overlay"}
                    data={wards}
                    style={styleFeature}
                    interactive={false}
                  />
                )}
                {selected && (
                  <Marker position={selected.position} icon={selectedLocationIcon}>
                    <Popup>
                      <strong>{selected.name}</strong>
                      <div>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</div>
                      <div>{wardAvailable ? `Ward ${props.ward_code} · ${celsius(props.lst_mean_c)} ward mean` : "No matching ward satellite observation"}</div>
                    </Popup>
                  </Marker>
                )}
              </MapContainer>
            </div>
            <div className="ward-legend" aria-label="Ward heat-class legend">
                <strong>Ward heat classes</strong>
                <span><i style={{ background: classColors.cooler }} /> Relatively cooler</span>
                <span><i style={{ background: classColors.moderate }} /> Moderate</span>
                <span><i style={{ background: classColors.hotter }} /> Relatively hotter</span>
                <small>Relative ward heat levels · Overlay is intentionally faint so streets and place names stay readable</small>
            </div>
            <div className="map-footer">
              <span><MapPin size={17} /> {selected ? `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}` : "Select a point on the map"}</span>
              <span>Ward polygons: {features.length}/24 · Map data © OpenStreetMap</span>
            </div>
            </div>
            <div className="area-card">
              <h3>What is this area like?</h3>
              {analysis ? (
                <>
                  <p className="muted-note">{spatialLabel} · Landsat {formatDate(analysis.observation_date)}</p>
                  <div className="feature-list readable-factors">
                    <div className="factor-item">
                      <Building2 size={20} />
                      <div>
                        <strong>Area type</strong>
                        <p className="factor-value">{areaType || "Area type not identified"}</p>
                      </div>
                    </div>
                    <div className="factor-item">
                      <TreePine size={20} />
                      <div>
                        <strong>Greenery</strong>
                        <p className="factor-value">{greeneryDescription(analysis.satellite_indices?.ndvi).label}</p>
                        <p>{greeneryDescription(analysis.satellite_indices?.ndvi).detail}</p>
                      </div>
                    </div>
                    <div className="factor-item">
                      <ThermometerSun size={20} />
                      <div>
                        <strong>Heat level</strong>
                        <p className="factor-value">{heatContext.label}</p>
                        <p>{celsius(observed)} observed surface temperature for the selected {isPolygon ? "mapped area" : "30-metre pixel"}. {heatContext.detail}</p>
                      </div>
                    </div>
                  </div>
                  <p className="muted-note">Greenery describes a satellite vegetation signal, not exact tree-cover percentage. Heat level compares the surrounding ward with other Mumbai wards, not the site's heat risk.</p>
                </>
              ) : wardAvailable ? (
                <>
                  <p className="muted-note">Ward {props.ward_code} overview · The selected site's conditions may differ.</p>
                  <div className="feature-list readable-factors">
                    <div className="factor-item">
                      <Building2 size={20} />
                      <div>
                        <strong>Area type</strong>
                        <p className="factor-value">Not yet identified</p>
                        <p>Select a location to request a land-use classification.</p>
                      </div>
                    </div>
                    <div className="factor-item">
                      <TreePine size={20} />
                      <div>
                        <strong>Greenery</strong>
                        <p className="factor-value">{greeneryDescription(props.ndvi_mean).label}</p>
                        <p>{greeneryDescription(props.ndvi_mean).detail}</p>
                      </div>
                    </div>
                    <div className="factor-item">
                      <ThermometerSun size={20} />
                      <div>
                        <strong>Heat level</strong>
                        <p className="factor-value">{heatContext.label}</p>
                        <p>{celsius(props.lst_mean_c)} average surface temperature across this ward. {heatContext.detail}</p>
                      </div>
                    </div>
                  </div>
                  <p className="muted-note">Ward-wide satellite measurements are not precise site measurements. Greenery is an indicator, not a tree-cover percentage.</p>
                </>
              ) : (
                <p className="muted-note">{selected ? "An area description is not available for this point yet." : "Select a location to explore its surroundings."}</p>
              )}
            </div>
          </div>

          <aside className="report-card">
            <div className="report-heading">
              <p className="eyebrow">LOCATION REPORT</p>
              <h2>{selected ? selected.name : "No location selected"}</h2>
              <p className="address">{selected ? selected.address : "Search for a place or click on the map"}</p>
              {selected && (
                <p className="ward-identifier">
                  {currentWard ? `BMC Ward ${props.ward_code || props.name}` : "Outside mapped BMC ward coverage"}
                </p>
              )}
            </div>

            <div className="report-section">
              <p className="small-heading">{analysis ? "OBSERVED SURFACE TEMPERATURE" : "SURFACE TEMPERATURE IN THIS WARD"}</p>
              <h3 className="temperature-value">{analysis ? celsius(observed) : wardAvailable ? celsius(props.lst_mean_c) : "-- °C"}</h3>
              <p className="muted-note">
                {analysis
                  ? `${spatialLabel}; Landsat ${formatDate(analysis.observation_date)}. Not air temperature or a future forecast.`
                  : wardAvailable
                    ? `Ward-wide average on ${formatDate(props.observation_date)}; not the precise selected location.`
                    : selected ? "Select a mapped Mumbai location for detailed analysis." : "Select a location to begin."}
              </p>
              {analysisLoading && <p className="analysis-status">Analysing satellite pixels and interventions…</p>}
              {analysisError && <p className="error-message" role="alert">{analysisError}</p>}
              {!analysis && wardAvailable && (
                <div className="temperature-explanation">
                  <ThermometerSun size={19} />
                  <div>
                    <strong>{currentClass === "hotter" ? "A warmer part of Mumbai" : currentClass === "cooler" ? "A relatively cooler part of Mumbai" : "Moderate surface heat"}</strong>
                    <p>{currentClass === "hotter"
                      ? "This ward has higher surface temperatures than many other Mumbai wards in this satellite observation."
                      : currentClass === "cooler"
                        ? "This ward has lower surface temperatures than many other Mumbai wards in this satellite observation."
                        : "This ward's surface temperature is around the middle of the range measured across Mumbai's wards."}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="prediction-box">
              <div className="prediction-icon"><ArrowUpRight size={23} /></div>
              <div>
                <p className="small-heading">2027 SURFACE TEMPERATURE PREDICTION</p>
                <h3>{wardForecast?.predicted_lst_c != null ? celsius(wardForecast.predicted_lst_c) : "-- °C"}</h3>
                {wardForecast?.predicted_lst_c != null ? (
                  <>
                    <p><strong>{wardForecast.target_period} · BMC Ward {wardForecast.ward}</strong></p>
                    <p>Predicted range: {celsius(wardForecast.lower_lst_c)} to {celsius(wardForecast.upper_lst_c)}</p>
                    <p>Based on historical satellite observations from 2013–2026 and a trained forecasting model.</p>
                    <p className="model-context">Ward-level seasonal prediction. Actual surface temperatures may vary with future weather and land-use changes.</p>
                  </>
                ) : (
                  <p>{forecastLoading ? "Calculating the ward-level prediction…" : selected ? "Ward-level prediction is currently unavailable for this location." : "Choose a location to see its ward-level prediction."}</p>
                )}
              </div>
            </div>

            {selected && (
              <div className="coordinates">
                <p>SELECTED COORDINATES</p>
                <span>Latitude: {selected.latitude.toFixed(6)}</span>
                <span>Longitude: {selected.longitude.toFixed(6)}</span>
              </div>
            )}
          </aside>
        </section>

        <section className="recommendations-card" aria-labelledby="recommendations-title">
          <p className="eyebrow">MITIGATION PLANNING</p>
          <h2 id="recommendations-title">Recommended interventions</h2>
          {analysisLoading ? (
            <p className="muted-note">Checking the selected location against satellite data and research-backed planning rules…</p>
          ) : recommendations.length ? (
            <>
              <p className="muted-note">Top {recommendations.length} recommended actions for {areaType || "this location"}, selected using local map and satellite information.</p>
              <div className="recommendation-grid">
                {recommendations.map((item, index) => (
                  <article className="recommendation-item" key={item.id || item.name}>
                    <div className="recommendation-top"><strong>{item.name}</strong><span>{item.priority === "higher" ? "Higher priority" : "Consider"}</span></div>
                    <p>{item.why_recommended}</p>
                    <p className="feasibility-line"><strong>Before implementation:</strong> {item.feasibility_check}</p>
                    <p className="reference-line">Evidence: {(item.evidence || []).map((paper) => paper.title).join("; ") || (item.evidence_ids || []).join(", ")}</p>
                    {index === greeningCardIndex && preferredGreeningScenario && (
                      <div className="intervention-impact" aria-label="Estimated response to a possible greening scenario">
                        <p className="impact-heading">If suitable spaces in this area become greener</p>
                        <div className="impact-metrics">
                          <div>
                            <span>Model-estimated decrease in LST</span>
                            <strong>{Math.abs(preferredGreeningScenario.temperatureChange).toFixed(2)}°C decrease</strong>
                          </div>
                          {preferredGreeningScenario.after !== null && (
                            <div>
                              <span>Estimated surface temperature after greening</span>
                              <strong>{celsius(preferredGreeningScenario.after)}</strong>
                            </div>
                          )}
                        </div>
                        {lowestGreeningTemp !== null && highestGreeningTemp !== null && (
                          <p className="impact-range">Estimated temperatures across the tested greening options: {celsius(lowestGreeningTemp)}–{celsius(highestGreeningTemp)}</p>
                        )}
                        <p className="impact-note">Based on {formatDate(areaVegetationScenarios.scene_date)} satellite data. This is a hypothetical area-wide greening scenario, not the measured result of this action or a 2027 forecast.</p>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-recommendations"><Leaf size={22} /><p>{analysisError ? "Connect the Python API to see research-informed recommendations." : "Select a location to see suitable interventions."}</p></div>
          )}
        </section>

        <footer className="footer">
          <span>URBAN HEAT MITIGATION · MUMBAI</span>
          <span>Research prototype · Landsat ward observations</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
