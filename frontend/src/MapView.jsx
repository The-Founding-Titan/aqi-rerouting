import { useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_LOCATION = [23.3441, 85.3096];

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(e) {
      onSelect([e.latlng.lat, e.latlng.lng]);
    },
  });

  return null;
}

// Select start, middle and end points along a route.
function sampleRoute(coordinates) {
  if (coordinates.length === 1) return [coordinates[0]];

  return [
    coordinates[0],
    coordinates[Math.floor((coordinates.length - 1) / 2)],
    coordinates[coordinates.length - 1],
  ];
}

async function getRoutePollution(coordinates) {
  const points = sampleRoute(coordinates);

  const latitudes = points.map(([lat]) => lat).join(",");
  const longitudes = points.map(([, lng]) => lng).join(",");

  const url =
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
    `?latitude=${latitudes}&longitude=${longitudes}` +
    "&current=us_aqi,pm2_5&timezone=auto";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Air-quality service unavailable.");
  }

  const result = await response.json();

  // Open-Meteo returns a list of objects for multiple coordinates.
  const locations = Array.isArray(result) ? result : [result];

  const samples = locations
    .map((location) => ({
      aqi: location.current?.us_aqi,
      pm25: location.current?.pm2_5,
      time: location.current?.time,
    }))
    .filter(
      (sample) => Number.isFinite(sample.aqi) && Number.isFinite(sample.pm25),
    );

  if (!samples.length) {
    throw new Error("No pollution data available for this route.");
  }

  return {
    averageAqi: Math.round(
      samples.reduce((sum, sample) => sum + sample.aqi, 0) / samples.length,
    ),
    averagePm25: Number(
      (
        samples.reduce((sum, sample) => sum + sample.pm25, 0) / samples.length
      ).toFixed(1),
    ),
    samples: samples.length,
    time: samples[0].time,
  };
}

function getAqiCategory(aqi) {
  if (aqi <= 50) return { label: "Good", color: "#168b75" };
  if (aqi <= 100) return { label: "Moderate", color: "#b7791f" };
  if (aqi <= 150)
    return { label: "Unhealthy for sensitive groups", color: "#c05621" };
  if (aqi <= 200) return { label: "Unhealthy", color: "#c53030" };
  if (aqi <= 300) return { label: "Very unhealthy", color: "#805ad5" };
  return { label: "Hazardous", color: "#822727" };
}

function scoreRoutes(routes) {
  const available = routes.filter(
    (route) =>
      route.pollution &&
      Number.isFinite(Number(route.pollution.averageAqi)) &&
      Number.isFinite(Number(route.pollution.averagePm25)) &&
      Number.isFinite(Number(route.duration)) &&
      Number.isFinite(Number(route.distance)),
  );

  if (available.length === 0) {
    return routes.map((route) => ({ ...route, score: null }));
  }

  const values = {
    aqi: available.map((r) => Number(r.pollution.averageAqi)),
    pm25: available.map((r) => Number(r.pollution.averagePm25)),
    time: available.map((r) => Number(r.duration)),
    distance: available.map((r) => Number(r.distance)),
  };

  function normalize(value, list) {
    const min = Math.min(...list);
    const max = Math.max(...list);
    return max === min ? 0 : (value - min) / (max - min);
  }

  return routes.map((route) => {
    if (!available.some((r) => r.id === route.id)) {
      return { ...route, score: null };
    }

    const score =
      50 * normalize(Number(route.pollution.averageAqi), values.aqi) +
      30 * normalize(Number(route.pollution.averagePm25), values.pm25) +
      10 * normalize(Number(route.duration), values.time) +
      10 * normalize(Number(route.distance), values.distance);

    return { ...route, score: Number(score.toFixed(1)) };
  });
}

export default function MapView() {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [selecting, setSelecting] = useState("origin");
  const [routes, setRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pollutionLoading, setPollutionLoading] = useState(false);
  const [error, setError] = useState("");
  const [pollutionError, setPollutionError] = useState("");

  const activeRoute = routes[selectedRoute];

  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");

  async function fetchForecast(latitude, longitude) {
    setForecastLoading(true);
    setForecastError("");
    setForecast(null);

    try {
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
      });

      const response = await fetch(
        `http://127.0.0.1:8000/api/forecast?${params}`,
      );

      if (!response.ok) {
        throw new Error("Could not load the PM2.5 forecast.");
      }

      const result = await response.json();
      setForecast(result);
    } catch (err) {
      setForecastError(err.message || "Forecast unavailable.");
    } finally {
      setForecastLoading(false);
    }
  }

  function handleMapClick(position) {
    setError("");
    setPollutionError("");
    setRoutes([]);

    if (selecting === "origin") {
      setOrigin(position);
      setDestination(null);
      setSelecting("destination");
    } else {
      setDestination(position);
      setSelecting("origin");
    }
  }

  async function findRoute() {
    if (!origin || !destination) {
      setError("Please select both locations on the map.");
      return;
    }

    setLoading(true);
    setError("");
    setPollutionError("");
    setPollutionLoading(false);
    setRoutes([]);
    setSelectedRoute(0);

    try {
      const url =
        "https://router.project-osrm.org/route/v1/driving/" +
        `${origin[1]},${origin[0]};${destination[1]},${destination[0]}` +
        "?alternatives=true&overview=full&geometries=geojson";

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Routing service unavailable. Please try again.");
      }

      const result = await response.json();

      if (result.code !== "Ok" || !result.routes?.length) {
        throw new Error("No route found between these locations.");
      }

      const formattedRoutes = result.routes.map((route, index) => ({
        id: index,
        distance: (route.distance / 1000).toFixed(2),
        duration: Math.round(route.duration / 60),
        coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        pollution: null,
        pollutionError: false,
      }));

      setRoutes(formattedRoutes);

      // Fetch pollution estimates for all returned routes.
      setLoading(false);
      setPollutionLoading(true);

      const updatedRoutes = await Promise.all(
        formattedRoutes.map(async (route) => {
          try {
            const pollution = await getRoutePollution(route.coordinates);
            return { ...route, pollution };
          } catch {
            return { ...route, pollutionError: true };
          }
        }),
      );

      setRoutes(scoreRoutes(updatedRoutes));

      if (updatedRoutes.every((route) => route.pollutionError)) {
        setPollutionError(
          "Routes were found, but pollution data could not be loaded.",
        );
      }
    } catch (err) {
      setError(err.message || "Could not calculate routes.");
    } finally {
      setLoading(false);
      setPollutionLoading(false);
    }
  }

  function resetRoute() {
    setOrigin(null);
    setDestination(null);
    setRoutes([]);
    setSelectedRoute(0);
    setError("");
    setPollutionError("");
    setLoading(false);
    setPollutionLoading(false);
    setSelecting("origin");
  }

  const rankedRoutes = routes
    .filter((route) => Number.isFinite(route.score))
    .sort((a, b) => a.score - b.score);

  const recommendedRoute = rankedRoutes[0] ?? null;
  const alternativeRoute = rankedRoutes[1] ?? null;

  return (
    <div>
      <p>
        {selecting === "origin"
          ? "Click the map to select your starting point."
          : "Click the map to select your destination."}
      </p>

      <MapContainer
        center={DEFAULT_LOCATION}
        zoom={12}
        style={{ height: "450px", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapClickHandler onSelect={handleMapClick} />

        {origin && <Marker position={origin} />}
        {destination && <Marker position={destination} />}

        {routes.map((route, index) => (
          <Polyline
            key={route.id}
            positions={route.coordinates}
            pathOptions={{
              color: index === selectedRoute ? "#168b75" : "#8b9a97",
              weight: index === selectedRoute ? 6 : 4,
              opacity: index === selectedRoute ? 1 : 0.55,
            }}
            eventHandlers={{
              click: () => setSelectedRoute(index),
            }}
          />
        ))}
      </MapContainer>

      {origin && (
        <p>
          <strong>Origin:</strong> {origin[0].toFixed(5)},{" "}
          {origin[1].toFixed(5)}
        </p>
      )}

      {destination && (
        <p>
          <strong>Destination:</strong> {destination[0].toFixed(5)},{" "}
          {destination[1].toFixed(5)}
        </p>
      )}

      <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
        <button onClick={findRoute} disabled={loading || pollutionLoading}>
          {loading
            ? "Finding routes..."
            : pollutionLoading
              ? "Checking pollution..."
              : "Find routes"}
        </button>

        <button onClick={resetRoute} disabled={loading || pollutionLoading}>
          Reset
        </button>

        <button
          onClick={() =>
            fetchForecast(
              destination?.[0] ?? origin?.[0] ?? DEFAULT_LOCATION[0],
              destination?.[1] ?? origin?.[1] ?? DEFAULT_LOCATION[1],
            )
          }
          disabled={forecastLoading}
        >
          {forecastLoading ? "Loading forecast..." : "Get PM2.5 forecast"}
        </button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {pollutionLoading && (
        <p>Fetching air-quality estimates along the routes...</p>
      )}

      {pollutionError && <p style={{ color: "#b7791f" }}>{pollutionError}</p>}

      {routes.length > 0 && (
        <section style={{ marginTop: "20px" }}>
          <h3>Available routes ({routes.length})</h3>

          <p style={{ color: "#168b75" }}>
            Green = selected route. Grey = alternative route.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "12px",
            }}
          >
            {routes.map((route, index) => (
              <button
                key={route.id}
                onClick={() => setSelectedRoute(index)}
                aria-pressed={selectedRoute === index}
                style={{
                  padding: "16px",
                  textAlign: "left",
                  borderRadius: "10px",
                  border:
                    selectedRoute === index
                      ? "2px solid #168b75"
                      : "1px solid #ccc",
                  background: selectedRoute === index ? "#eef7f3" : "white",
                  color: "#17231f",
                  cursor: "pointer",
                }}
              >
                <strong>
                  Route {index + 1}
                  {route.score != null &&
                    route.score ===
                      Math.min(
                        ...routes
                          .filter((r) => r.score != null)
                          .map((r) => r.score),
                      ) && (
                      <span style={{ color: "#168b75", marginLeft: "8px" }}>
                        Recommended
                      </span>
                    )}
                </strong>
                <p>Distance: {route.distance} km</p>
                <p>Estimated time: {route.duration} min</p>

                {route.pollution ? (
                  <>
                    <p>Estimated average AQI: {route.pollution.averageAqi}</p>
                    <p>Average PM2.5: {route.pollution.averagePm25} µg/m³</p>
                  </>
                ) : route.pollutionError ? (
                  <p>Pollution data unavailable</p>
                ) : (
                  <p>Pollution data pending...</p>
                )}

                {route.score != null && (
                  <p>
                    <strong>Route score:</strong> {route.score}/100
                    <br />
                    <small>Lower is better among the available routes.</small>
                  </p>
                )}

                {selectedRoute === index && <strong>Selected</strong>}
              </button>
            ))}
          </div>

          {recommendedRoute && alternativeRoute && (
            <div
              style={{
                marginTop: "20px",
                padding: "20px",
                borderRadius: "12px",
                background: "#eef7f3",
                border: "1px solid #168b75",
                color: "#17231f",
              }}
            >
              <h3 style={{ marginTop: 0 }}>🏆 Why this route is recommended</h3>

              <p>
                Route{" "}
                {routes.findIndex((r) => r.id === recommendedRoute.id) + 1} has
                the lowest pollution-aware route score.
              </p>

              <p>
                <strong>Distance:</strong>{" "}
                {Math.abs(
                  Number(alternativeRoute.distance) -
                    Number(recommendedRoute.distance),
                ).toFixed(2)}{" "}
                km{" "}
                {Number(recommendedRoute.distance) <
                Number(alternativeRoute.distance)
                  ? "shorter"
                  : Number(recommendedRoute.distance) >
                      Number(alternativeRoute.distance)
                    ? "longer"
                    : "— same distance"}
                than the next-best alternative.
              </p>

              <p>
                <strong>Travel time:</strong>{" "}
                {Math.abs(
                  Number(alternativeRoute.duration) -
                    Number(recommendedRoute.duration),
                ).toFixed(0)}{" "}
                minutes{" "}
                {Number(recommendedRoute.duration) <
                Number(alternativeRoute.duration)
                  ? "faster"
                  : Number(recommendedRoute.duration) >
                      Number(alternativeRoute.duration)
                    ? "slower"
                    : "— same estimated time"}
                than the next-best alternative.
              </p>

              {recommendedRoute.pollution && alternativeRoute.pollution && (
                <>
                  <p>
                    <strong>Estimated AQI:</strong>{" "}
                    {recommendedRoute.pollution.averageAqi} vs.{" "}
                    {alternativeRoute.pollution.averageAqi}
                  </p>

                  <p>
                    <strong>Average PM2.5:</strong>{" "}
                    {recommendedRoute.pollution.averagePm25} vs.{" "}
                    {alternativeRoute.pollution.averagePm25} µg/m³
                  </p>
                </>
              )}

              <p style={{ fontSize: "13px", color: "#52615b" }}>
                This recommendation compares available routes using their
                pollution estimates, travel time, and distance. Pollution values
                are approximate, and the score is not a health or safety rating.
              </p>
            </div>
          )}
        </section>
      )}

      {activeRoute && (
        <div
          style={{
            marginTop: "16px",
            padding: "16px",
            borderRadius: "10px",
            background: "#eef7f3",
          }}
        >
          <h3>Selected route details</h3>
          <p>
            <strong>Distance:</strong> {activeRoute.distance} km
          </p>
          <p>
            <strong>Estimated travel time:</strong> {activeRoute.duration} min
          </p>

          {activeRoute.pollution && (
            <>
              <p>
                <strong>Sampled average AQI:</strong>{" "}
                {activeRoute.pollution.averageAqi}
              </p>
              <p>
                <strong>AQI category:</strong>{" "}
                {getAqiCategory(activeRoute.pollution.averageAqi).label}
              </p>
              <p>
                <strong>Average PM2.5:</strong>{" "}
                {activeRoute.pollution.averagePm25} µg/m³
              </p>
              <p>
                <strong>Locations sampled:</strong>{" "}
                {activeRoute.pollution.samples}
              </p>
              <p>
                <strong>Pollution data time:</strong>{" "}
                {activeRoute.pollution.time}
              </p>
            </>
          )}

          <p style={{ fontSize: "13px", color: "#52615b" }}>
            Pollution values are model-based estimates at a few sampled
            locations, not measurements of your exact street-level exposure.
            They are not a medical or health-risk assessment.
          </p>

          {forecastError && <p style={{ color: "crimson" }}>{forecastError}</p>}

          {forecast && (
            <section
              style={{
                marginTop: "20px",
                padding: "20px",
                border: "1px solid #cbd5d1",
                borderRadius: "12px",
                background: "#f0f8f5",
                color: "#17231f",
              }}
            >
              <h3 style={{ marginTop: 0 }}>Hourly PM2.5 forecast</h3>

              <p>
                <strong>Location:</strong> {forecast.latitude},{" "}
                {forecast.longitude}
              </p>

              <p>
                <strong>Source:</strong> {forecast.source}
              </p>

              <p style={{ fontSize: "13px", color: "#52615b" }}>
                Provider-generated forecast, not a prediction from our
                experimental Delhi-trained model. Values are approximate.
              </p>

              {forecastLoading ? (
                <p>Loading forecast...</p>
              ) : forecast.forecasts?.length > 0 ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                    gap: "12px",
                    marginTop: "16px",
                  }}
                >
                  {forecast.forecasts.slice(0, 6).map((item) => (
                    <div
                      key={item.time}
                      style={{
                        padding: "14px",
                        borderRadius: "10px",
                        background: "white",
                        border: "1px solid #d8e3de",
                      }}
                    >
                      <p style={{ margin: "0 0 8px", fontSize: "13px" }}>
                        {item.time.replace("T", " ")}
                      </p>

                      <strong style={{ fontSize: "22px" }}>
                        {Number(item.pm2_5).toFixed(1)}
                      </strong>

                      <p style={{ margin: "4px 0 0", fontSize: "12px" }}>
                        µg/m³ PM2.5
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p>
                  No future hourly forecasts are available for this location.
                </p>
              )}
            </section>
          )}
        </div>
      )}

      {activeRoute?.score != null && (
        <p>
          <strong>Route score:</strong> {activeRoute.score}/100
        </p>
      )}
    </div>
  );
}
