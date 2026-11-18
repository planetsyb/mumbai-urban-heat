
import { useState, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents
} from "react-leaflet";
import L from "leaflet";
import {
  Search,
  MapPin,
  ThermometerSun,
  Leaf,
  ArrowUpRight,
  Navigation,
  LoaderCircle,
  Info,
  TreePine,
  Building2,
  Droplets
} from "lucide-react";

import "leaflet/dist/leaflet.css";
import "./App.css";

// Mumbai Suburban map's initial viewing position
const MUMBAI_CENTER = [19.135, 72.875];

// Custom pin for the selected location
const selectedLocationIcon = L.divIcon({
  className: "selected-location-marker",
  html: '<div class="location-pin"></div>',
  iconSize: [28, 36],
  iconAnchor: [14, 34]
});

// Moves the map when a searched location is selected
function MapController({ selected }) {
  const map = useMap();

  useEffect(() => {
    if (selected?.position) {
      map.flyTo(selected.position, 16, {
        duration: 1.2
      });
    }
  }, [selected, map]);

  return null;
}

// Detects clicks anywhere on the map
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reverse geocoding:
  // Converts clicked coordinates into a readable place name.
  async function selectCoordinates(latitude, longitude) {
    setLoading(true);
    setError("");

    const newLocation = {
      name: "Selected map location",
      address: "Retrieving location details...",
      latitude,
      longitude,
      position: [latitude, longitude]
    };

    setSelected(newLocation);
    setSearch(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);

    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
        `&lat=${latitude}&lon=${longitude}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Could not retrieve the place name.");
      }

      const data = await response.json();

      setSelected({
        ...newLocation,
        name: data.name || "Selected location",
        address: data.display_name || "Location identified by coordinates"
      });
    } catch (err) {
      setSelected({
        ...newLocation,
        address: "Place name unavailable. Coordinates are still selected."
      });
    } finally {
      setLoading(false);
    }
  }

  // Search for a landmark, neighbourhood or coordinates.
  async function handleSearch(event) {
    event.preventDefault();

    const query = search.trim();

    if (!query) {
      setError("Enter a place name or coordinates.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Check whether the user entered latitude, longitude.
      const coordinateMatch = query.match(
        /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
      );

      if (coordinateMatch) {
        const latitude = Number(coordinateMatch[1]);
        const longitude = Number(coordinateMatch[2]);

        if (
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          throw new Error("Please enter valid latitude and longitude.");
        }

        await selectCoordinates(latitude, longitude);
        return;
      }

      // Search dynamically using OpenStreetMap's geocoding service.
      const encodedQuery = encodeURIComponent(
        `${query}, Mumbai, Maharashtra, India`
      );

      const url =
        `https://nominatim.openstreetmap.org/search?format=jsonv2` +
        `&q=${encodedQuery}` +
        `&viewbox=72.70,19.35,73.10,18.90` +
        `&bounded=1&limit=1`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Location search is temporarily unavailable.");
      }

      const results = await response.json();

      if (!results.length) {
        throw new Error(
          "We couldn't find that location in the Mumbai study region. Try another name or coordinates."
        );
      }

      const result = results[0];

      const latitude = Number(result.lat);
      const longitude = Number(result.lon);

      setSelected({
        name: result.name || query,
        address: result.display_name,
        latitude,
        longitude,
        position: [latitude, longitude]
      });
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <ThermometerSun size={27} />
          </div>

          <div>
            <h2>URBAN HEAT</h2>
            <p>MUMBAI HEAT MITIGATION PLANNER</p>
          </div>
        </div>

        <div className="region-label">
          <MapPin size={19} />
          Mumbai Suburban, Maharashtra
        </div>
      </header>

      <main className="main-content">
        {/* Introduction */}
        <section className="intro">
          <p className="eyebrow">UNDERSTAND YOUR SURROUNDINGS</p>
          <h1>Explore heat. Discover solutions.</h1>
          <p className="intro-description">
            Find out how hot an area is, understand why, and discover
            ways to make it cooler.
          </p>
        </section>

        {/* Regional overview */}
        <section className="overview-card">
          <div className="overview-heading">
            <div>
              <p className="eyebrow">REGIONAL OVERVIEW</p>
              <h2>Mumbai Suburban</h2>
              <p>Forests, lakes and urban neighbourhoods</p>
            </div>

            <div className="overview-icon">
              <Navigation size={27} />
            </div>
          </div>

          <div className="regional-temperature">
            <div>
              <p className="small-heading">
                REGION AVERAGE SURFACE TEMPERATURE
              </p>
              <h3>-- °C</h3>
              <p>Waiting for satellite data integration</p>
            </div>

            <ThermometerSun size={38} />
          </div>

          <div className="observation-info">
            <span>
              <Info size={17} />
              Latest valid satellite observation
            </span>
            <span>Observation date: --</span>
          </div>
        </section>

        {/* Search */}
        <section className="search-section">
          <h2>Find a location</h2>
          <p>Search by landmark, neighbourhood or coordinates.</p>

          <form className="search-box" onSubmit={handleSearch}>
            <Search size={23} />

            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Try Marol, Powai, SGNP or 19.135, 72.875..."
            />

            <button type="submit" disabled={loading}>
              {loading ? (
                <LoaderCircle className="spin" size={19} />
              ) : (
                <>
                  Explore <ArrowUpRight size={18} />
                </>
              )}
            </button>
          </form>

          {error && <p className="error-message">{error}</p>}
        </section>

        {/* Map and location report */}
        <section className="results-layout">
          <div className="map-card">
            <div className="card-heading">
              <div>
                <h2>Explore Mumbai</h2>
                <p>Click anywhere on the map to select a location</p>
              </div>

              <span className="live-label">
                <span className="live-dot"></span>
                INTERACTIVE MAP
              </span>
            </div>

            <div className="map-wrapper">
              <MapContainer
                center={MUMBAI_CENTER}
                zoom={11}
                minZoom={9}
                maxZoom={19}
                scrollWheelZoom={true}
                className="mumbai-map"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <MapClickHandler
                  onLocationSelect={selectCoordinates}
                />

                <MapController selected={selected} />

                {selected && (
                  <Marker
                    position={selected.position}
                    icon={selectedLocationIcon}
                  >
                    <Popup>
                      <strong>{selected.name}</strong>
                      <br />
                      {selected.latitude.toFixed(5)},{" "}
                      {selected.longitude.toFixed(5)}
                    </Popup>
                  </Marker>
                )}
              </MapContainer>
            </div>

            <div className="map-footer">
              <span>
                <MapPin size={17} />
                {selected
                  ? `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}`
                  : "Select a point on the map"}
              </span>

              <span>Map data © OpenStreetMap</span>
            </div>
          </div>

          {/* Location report */}
          <aside className="report-card">
            <div className="report-heading">
              <p className="eyebrow">LOCATION REPORT</p>
              <h2>{selected ? selected.name : "No location selected"}</h2>
              <p className="address">
                {selected
                  ? selected.address
                  : "Search for a place or click on the map"}
              </p>
            </div>

            <div className="report-section">
              <p className="small-heading">LATEST SURFACE TEMPERATURE</p>
              <h3 className="temperature-value">-- °C</h3>
              <p className="muted-note">
                {selected
                  ? "Satellite data has not been connected yet."
                  : "Select a location to begin."}
              </p>
            </div>

            <div className="prediction-box">
              <div className="prediction-icon">
                <ArrowUpRight size={23} />
              </div>

              <div>
                <p className="small-heading">FUTURE PREDICTION</p>
                <h3>-- °C</h3>
                <p>Without any intervention</p>
              </div>
            </div>

            <div className="report-section">
              <h3>What influences the heat here?</h3>

              <p className="muted-note">
                {selected
                  ? "Geographical analysis will identify the local factors contributing to heat."
                  : "Select a location to explore its surroundings."}
              </p>

              <div className="feature-list">
                <span><Building2 size={17} /> Built-up areas and roads</span>
                <span><TreePine size={17} /> Vegetation and green spaces</span>
                <span><Droplets size={17} /> Lakes and water bodies</span>
              </div>
            </div>

            <div className="report-section">
              <h3>Recommended interventions</h3>

              <div className="empty-recommendations">
                <Leaf size={22} />
                <p>
                  Location-specific recommendations will appear here
                  after geographical analysis.
                </p>
              </div>
            </div>

            <div className="after-intervention">
              <p className="small-heading">AFTER INTERVENTION</p>
              <h3>-- °C</h3>
              <p>
                Select a recommended intervention to view its
                predicted cooling scenario.
              </p>
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

        <footer className="footer">
          <span>URBAN HEAT MITIGATION · MUMBAI</span>
          <span>Research prototype · Development in progress</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
