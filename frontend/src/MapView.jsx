import { useEffect, useState } from 'react'

import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  CircleMarker,
  Popup,
  GeoJSON,
  useMap,
  useMapEvents,
} from 'react-leaflet'

import 'leaflet/dist/leaflet.css'

const API_BASE_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:8000'
  : 'https://aqi-rerouting.onrender.com'

const DEFAULT_LOCATION = [23.3441, 85.3096]

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(e) {
      onSelect([e.latlng.lat, e.latlng.lng])
    },
  })

  return null
}

// Select start, middle and end points along a route.
function sampleRoute(coordinates) {
  if (coordinates.length <= 7) return coordinates

  return Array.from({ length: 7 }, (_, i) => {
    const index = Math.round((i * (coordinates.length - 1)) / 6)

    return coordinates[index]
  })
}

function calculateAqiFromPm25(pm25) {
  if (!Number.isFinite(pm25) || pm25 < 0 || pm25 > 500) {
    return null
  }

  const breakpoints = [
    { cLow: 0, cHigh: 30, iLow: 0, iHigh: 50 },
    { cLow: 30, cHigh: 60, iLow: 50, iHigh: 100 },
    { cLow: 60, cHigh: 90, iLow: 100, iHigh: 200 },
    { cLow: 90, cHigh: 120, iLow: 200, iHigh: 300 },
    { cLow: 120, cHigh: 250, iLow: 300, iHigh: 400 },
    { cLow: 250, cHigh: 500, iLow: 400, iHigh: 500 },
  ]

  const range = breakpoints.find((b) => pm25 >= b.cLow && pm25 <= b.cHigh)

  if (!range) return null

  const aqi =
    ((range.iHigh - range.iLow) / (range.cHigh - range.cLow)) *
      (pm25 - range.cLow) +
    range.iLow

  return Math.round(aqi)
}

async function getRoutePollution(coordinates) {
  const points = sampleRoute(coordinates)

  const results = await Promise.all(
    points.map(async (point) => {
      const url = new URL(`${API_BASE_URL}/api/pm25-prediction`)

      url.searchParams.set('latitude', point[0])
      url.searchParams.set('longitude', point[1])

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error('Pollution data unavailable')
      }

      const data = await response.json()

      const pm25 =
        data.region === 'Delhi'
          ? data.prediction?.prediction
          : data.current?.pm2_5

      if (!Number.isFinite(pm25)) {
        throw new Error('Invalid PM2.5 value')
      }

      const aqi = calculateAqiFromPm25(pm25)

      return {
        requestedCoordinate: point,
        pm25,
        aqi,
        region: data.region,
        source: data.source,
        dataType: data.data_type,
        time:
          data.region === 'Delhi'
            ? data.prediction?.prediction_for
            : data.current?.time,
      }
    })
  )

  const validResults = results.filter((item) => item.aqi !== null)

  const averagePm25 =
    results.reduce((sum, item) => sum + item.pm25, 0) / results.length

  const averageAqi = validResults.length
    ? validResults.reduce((sum, item) => sum + item.aqi, 0) /
      validResults.length
    : null

  const resultData = {
    averagePm25,
    averageAqi,
    samples: results.length,
    locations: results,
  }

  console.table(results)
  console.log('FINAL HYBRID ROUTE POLLUTION:', resultData)

  return resultData
}

function getAqiCategory(aqi) {
  if (aqi <= 50) return { label: 'Good', color: '#168b75' }
  if (aqi <= 100) return { label: 'Satisfactory', color: '#65a30d' }
  if (aqi <= 200) return { label: 'Moderate', color: '#b7791f' }
  if (aqi <= 300) return { label: 'Poor', color: '#c05621' }
  if (aqi <= 400) return { label: 'Very Poor', color: '#c53030' }
  return { label: 'Severe', color: '#822727' }
}

function scoreRoutes(routes) {
  const available = routes.filter(
    (route) =>
      route.pollution &&
      Number.isFinite(Number(route.pollution.averagePm25)) &&
      Number.isFinite(Number(route.duration)) &&
      Number.isFinite(Number(route.distance))
  )

  if (available.length === 0) {
    return routes.map((route) => ({ ...route, score: null }))
  }

  const values = {
    pm25: available.map((r) => Number(r.pollution.averagePm25)),
    time: available.map((r) => Number(r.duration)),
    distance: available.map((r) => Number(r.distance)),
  }

  function normalize(value, list) {
    const min = Math.min(...list)
    const max = Math.max(...list)

    return max === min ? 0 : (value - min) / (max - min)
  }

  return routes.map((route) => {
    if (!available.some((r) => r.id === route.id)) {
      return { ...route, score: null }
    }

    const score =
      70 * normalize(Number(route.pollution.averagePm25), values.pm25) +
      15 * normalize(Number(route.duration), values.time) +
      15 * normalize(Number(route.distance), values.distance)

    return { ...route, score: Number(score.toFixed(1)) }
  })
}

function getPm25Color(value) {
  if (value <= 30) return '#168b75'
  if (value <= 60) return '#84a83c'
  if (value <= 90) return '#d69e2e'
  if (value <= 120) return '#dd6b20'
  if (value <= 250) return '#c53030'
  return '#702459'
}

function MapFocusController({ focusDelhi }) {
  const map = useMap()

  useEffect(() => {
    if (focusDelhi > 0) {
      map.setView([28.6139, 77.209], 11)
    }
  }, [focusDelhi, map])

  return null
}

export default function MapView() {
  const [origin, setOrigin] = useState(null)
  const [destination, setDestination] = useState(null)
  const [selecting, setSelecting] = useState('origin')
  const [routes, setRoutes] = useState([])
  const [selectedRoute, setSelectedRoute] = useState(0)
  const [loading, setLoading] = useState(false)
  const [pollutionLoading, setPollutionLoading] = useState(false)
  const [error, setError] = useState('')
  const [pollutionError, setPollutionError] = useState('')
  const [stations, setStations] = useState([])
  const [stationLoading, setStationLoading] = useState(false)
  const [stationError, setStationError] = useState('')
  const [focusDelhi, setFocusDelhi] = useState(0)
  const [delhiBoundary, setDelhiBoundary] = useState(null)
  const [boundaryError, setBoundaryError] = useState('')

  const activeRoute = routes[selectedRoute]

  const [forecast, setForecast] = useState(null)
  const [forecastLoading, setForecastLoading] = useState(false)
  const [forecastError, setForecastError] = useState('')

  async function fetchForecast(latitude, longitude) {
    setForecastLoading(true)
    setForecastError('')
    setForecast(null)

    try {
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
      })

      const response = await fetch(`${API_BASE_URL}/api/forecast?${params}`)

      if (!response.ok) {
        throw new Error('Could not load the PM2.5 forecast.')
      }

      const result = await response.json()
      setForecast(result)
    } catch (err) {
      setForecastError(err.message || 'Forecast unavailable.')
    } finally {
      setForecastLoading(false)
    }
  }
  async function fetchDelhiStations() {
    setStationLoading(true)
    setStationError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/delhi/stations`)

      if (!response.ok) {
        throw new Error('Could not load Delhi station data.')
      }

      const result = await response.json()
      setStations(result.stations || [])
    } catch (error) {
      setStationError(error.message)
    } finally {
      setStationLoading(false)
    }
  }

  useEffect(() => {
    fetchDelhiStations()
  }, [])
  useEffect(() => {
    async function loadBoundary() {
      try {
        const response = await fetch('/delhi_boundary.geojson')

        if (!response.ok) {
          throw new Error('Could not load Delhi boundary.')
        }

        const data = await response.json()
        setDelhiBoundary(data)
      } catch (error) {
        setBoundaryError(error.message)
      }
    }

    loadBoundary()
  }, [])

  function handleMapClick(position) {
    setError('')
    setPollutionError('')
    setRoutes([])

    if (selecting === 'origin') {
      setOrigin(position)
      setDestination(null)
      setSelecting('destination')
    } else {
      setDestination(position)
      setSelecting('origin')
    }
  }

  async function findRoute() {
    if (!origin || !destination) {
      setError('Please select both locations on the map.')
      return
    }

    setLoading(true)
    setError('')
    setPollutionError('')
    setPollutionLoading(false)
    setRoutes([])
    setSelectedRoute(0)

    try {
      const url =
        'https://router.project-osrm.org/route/v1/driving/' +
        `${origin[1]},${origin[0]};${destination[1]},${destination[0]}` +
        '?alternatives=true&overview=full&geometries=geojson'

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error('Routing service unavailable. Please try again.')
      }

      const result = await response.json()

      if (result.code !== 'Ok' || !result.routes?.length) {
        throw new Error('No route found between these locations.')
      }

      const formattedRoutes = result.routes.map((route, index) => ({
        id: index,
        distance: (route.distance / 1000).toFixed(2),
        duration: Math.round(route.duration / 60),
        coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        pollution: null,
        pollutionError: false,
      }))

      setRoutes(formattedRoutes)

      // Fetch pollution estimates for all returned routes.
      setLoading(false)
      setPollutionLoading(true)

      const updatedRoutes = await Promise.all(
        formattedRoutes.map(async (route) => {
          try {
            const pollution = await getRoutePollution(route.coordinates)
            return { ...route, pollution }
          } catch {
            return { ...route, pollutionError: true }
          }
        })
      )

      setRoutes(scoreRoutes(updatedRoutes))

      if (updatedRoutes.every((route) => route.pollutionError)) {
        setPollutionError(
          'Routes were found, but pollution data could not be loaded.'
        )
      }
    } catch (err) {
      setError(err.message || 'Could not calculate routes.')
    } finally {
      setLoading(false)
      setPollutionLoading(false)
    }
  }

  function resetRoute() {
    setOrigin(null)
    setDestination(null)
    setRoutes([])
    setSelectedRoute(0)
    setError('')
    setPollutionError('')
    setLoading(false)
    setPollutionLoading(false)
    setSelecting('origin')
  }

  const rankedRoutes = routes
    .filter((route) => Number.isFinite(route.score))
    .sort((a, b) => a.score - b.score)

  const recommendedRoute = rankedRoutes[0] ?? null
  const alternativeRoute = rankedRoutes[1] ?? null

  return (
    <div>
      <p>
        {selecting === 'origin'
          ? 'Click the map to select your starting point.'
          : 'Click the map to select your destination.'}
      </p>

      <MapContainer
        center={DEFAULT_LOCATION}
        zoom={12}
        style={{ height: '450px', width: '100%' }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {delhiBoundary && (
          <GeoJSON
            data={delhiBoundary}
            style={() => ({
              color: '#2563eb',
              weight: 3,
              opacity: 0.9,
              fillColor: '#3b82f6',
              fillOpacity: 0.06,
              dashArray: '8 6',
            })}
          />
        )}

        <MapClickHandler onSelect={handleMapClick} />
        <MapFocusController focusDelhi={focusDelhi} />

        {stations.map((station) => (
          <CircleMarker
            key={station.key}
            center={[station.latitude, station.longitude]}
            radius={13}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: getPm25Color(station.pm25),
              fillOpacity: 0.9,
            }}
          >
            <Popup>
              <strong>{station.name}</strong>
              <br />
              PM2.5: {station.pm25} µg/m³
              <br />
              Updated: {station.timestamp}
              <br />
              Observations: {station.observation_count}
            </Popup>
          </CircleMarker>
        ))}

        {origin && <Marker position={origin} />}
        {destination && <Marker position={destination} />}

        {routes.map((route, index) => (
          <Polyline
            key={route.id}
            positions={route.coordinates}
            pathOptions={{
              color: index === selectedRoute ? '#168b75' : '#8b9a97',
              weight: index === selectedRoute ? 6 : 4,
              opacity: index === selectedRoute ? 1 : 0.55,
            }}
            eventHandlers={{
              click: () => setSelectedRoute(index),
            }}
          />
        ))}
      </MapContainer>
      {boundaryError && <p style={{ color: 'crimson' }}>{boundaryError}</p>}

      <p style={{ fontSize: '12px', color: '#64748b' }}>
        Blue outline: Delhi boundary dataset (provisional; administrative
        provenance not yet verified).
      </p>

      {stationError && <p style={{ color: 'crimson' }}>{stationError}</p>}

      <div style={{ marginTop: '12px' }}>
        <strong>Delhi PM2.5 monitoring stations</strong>
        <p style={{ fontSize: '13px' }}>
          {stations.length} stations available · DPCC live data
        </p>

        {[
          ['#168b75', 'Good (0–30)'],
          ['#84a83c', 'Satisfactory (31–60)'],
          ['#d69e2e', 'Moderate (61–90)'],
          ['#dd6b20', 'Poor (91–120)'],
          ['#c53030', 'Very Poor (121–250)'],
          ['#702459', 'Severe (>250)'],
        ].map(([color, label]) => (
          <span
            key={label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              margin: '5px 12px 5px 0',
              fontSize: '12px',
            }}
          >
            <span
              style={{
                width: '11px',
                height: '11px',
                borderRadius: '50%',
                background: color,
              }}
            />
            {label}
          </span>
        ))}
      </div>

      {origin && (
        <p>
          <strong>Origin:</strong> {origin[0].toFixed(5)},{' '}
          {origin[1].toFixed(5)}
        </p>
      )}

      {destination && (
        <p>
          <strong>Destination:</strong> {destination[0].toFixed(5)},{' '}
          {destination[1].toFixed(5)}
        </p>
      )}

      <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
        <button onClick={findRoute} disabled={loading || pollutionLoading}>
          {loading
            ? 'Finding routes...'
            : pollutionLoading
              ? 'Checking pollution...'
              : 'Find routes'}
        </button>

        <button onClick={resetRoute} disabled={loading || pollutionLoading}>
          Reset
        </button>

        <button
          onClick={() =>
            fetchForecast(
              destination?.[0] ?? origin?.[0] ?? DEFAULT_LOCATION[0],
              destination?.[1] ?? origin?.[1] ?? DEFAULT_LOCATION[1]
            )
          }
          disabled={forecastLoading}
        >
          {forecastLoading ? 'Loading forecast...' : 'Get PM2.5 forecast'}
        </button>
        <button onClick={() => setFocusDelhi((value) => value + 1)}>
          Show Delhi stations
        </button>

        <button onClick={fetchDelhiStations} disabled={stationLoading}>
          {stationLoading ? 'Refreshing...' : 'Refresh station data'}
        </button>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {pollutionLoading && (
        <p>Fetching air-quality estimates along the routes...</p>
      )}

      {pollutionError && <p style={{ color: '#b7791f' }}>{pollutionError}</p>}

      {routes.length > 0 && (
        <section style={{ marginTop: '20px' }}>
          <h3>Available routes ({routes.length})</h3>

          <p style={{ color: '#168b75' }}>
            Green = selected route. Grey = alternative route.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
            }}
          >
            {routes.map((route, index) => (
              <button
                key={route.id}
                onClick={() => setSelectedRoute(index)}
                aria-pressed={selectedRoute === index}
                style={{
                  padding: '16px',
                  textAlign: 'left',
                  borderRadius: '10px',
                  border:
                    selectedRoute === index
                      ? '2px solid #168b75'
                      : '1px solid #ccc',
                  background: selectedRoute === index ? '#eef7f3' : 'white',
                  color: '#17231f',
                  cursor: 'pointer',
                }}
              >
                <strong>
                  Route {index + 1}
                  {route.score != null &&
                    route.score ===
                      Math.min(
                        ...routes
                          .filter((r) => r.score != null)
                          .map((r) => r.score)
                      ) && (
                      <span style={{ color: '#168b75', marginLeft: '8px' }}>
                        Recommended
                      </span>
                    )}
                </strong>
                <p>Distance: {route.distance} km</p>
                <p>Estimated time: {route.duration} min</p>

                {route.pollution ? (
                  <>
                    <p>
                      Estimated PM2.5-based AQI:{' '}
                      {route.pollution.averageAqi != null
                        ? Math.round(route.pollution.averageAqi)
                        : 'Unavailable'}
                    </p>

                    <p>
                      Average PM2.5: {route.pollution.averagePm25.toFixed(1)}{' '}
                      µg/m³
                    </p>
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
                marginTop: '20px',
                padding: '20px',
                borderRadius: '12px',
                background: '#eef7f3',
                border: '1px solid #168b75',
                color: '#17231f',
              }}
            >
              <h3 style={{ marginTop: 0 }}>🏆 Why this route is recommended</h3>

              <p>
                Route{' '}
                {routes.findIndex((r) => r.id === recommendedRoute.id) + 1} has
                the lowest pollution-aware route score.
              </p>

              <p>
                <strong>Distance:</strong>{' '}
                {Math.abs(
                  Number(alternativeRoute.distance) -
                    Number(recommendedRoute.distance)
                ).toFixed(2)}{' '}
                km{' '}
                {Number(recommendedRoute.distance) <
                Number(alternativeRoute.distance)
                  ? 'shorter'
                  : Number(recommendedRoute.distance) >
                      Number(alternativeRoute.distance)
                    ? 'longer'
                    : '— same distance'}
                than the next-best alternative.
              </p>

              <p>
                <strong>Travel time:</strong>{' '}
                {Math.abs(
                  Number(alternativeRoute.duration) -
                    Number(recommendedRoute.duration)
                ).toFixed(0)}{' '}
                minutes{' '}
                {Number(recommendedRoute.duration) <
                Number(alternativeRoute.duration)
                  ? 'faster'
                  : Number(recommendedRoute.duration) >
                      Number(alternativeRoute.duration)
                    ? 'slower'
                    : '— same estimated time'}
                than the next-best alternative.
              </p>

              {recommendedRoute.pollution && alternativeRoute.pollution && (
                <>
                  <p>
                    <strong>Estimated PM2.5-based AQI:</strong>{' '}
                    {Math.round(recommendedRoute.pollution.averageAqi)} vs.{' '}
                    {Math.round(alternativeRoute.pollution.averageAqi)}
                  </p>

                  <p>
                    <strong>Average PM2.5:</strong>{' '}
                    {recommendedRoute.pollution.averagePm25} vs.{' '}
                    {alternativeRoute.pollution.averagePm25} µg/m³
                  </p>
                </>
              )}

              <p style={{ fontSize: '13px', color: '#52615b' }}>
                AQI is an estimated PM2.5-based sub-index, not the official
                overall CPCB AQI. Pollution values are approximate and may
                combine next-hour predictions with current estimates. The route
                score is not a health or safety rating.
              </p>
            </div>
          )}
        </section>
      )}

      {activeRoute && (
        <div
          style={{
            marginTop: '16px',
            padding: '16px',
            borderRadius: '10px',
            background: '#eef7f3',
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
                <strong>Estimated PM2.5-based AQI:</strong>{' '}
                {activeRoute.pollution.averageAqi != null
                  ? Math.round(activeRoute.pollution.averageAqi)
                  : 'Unavailable'}
              </p>

              <p>
                <strong>Average PM2.5:</strong>{' '}
                {activeRoute.pollution.averagePm25.toFixed(1)} µg/m³
              </p>

              <p>
                <strong>Locations sampled:</strong>{' '}
                {activeRoute.pollution.samples}
              </p>

              <p>
                <strong>Data sources:</strong>{' '}
                {[
                  ...new Set(
                    activeRoute.pollution.locations.map((item) => item.source)
                  ),
                ].join(', ')}
              </p>

              <p>
                <strong>Data basis:</strong>{' '}
                {[
                  ...new Set(
                    activeRoute.pollution.locations.map((item) => item.dataType)
                  ),
                ].join(' + ')}
              </p>
            </>
          )}

          <p style={{ fontSize: '13px', color: '#52615b' }}>
            Pollution values are model-based estimates at a few sampled
            locations, not measurements of your exact street-level exposure.
            They are not a medical or health-risk assessment.
          </p>

          {forecastError && <p style={{ color: 'crimson' }}>{forecastError}</p>}

          {forecast && (
            <section
              style={{
                marginTop: '20px',
                padding: '20px',
                border: '1px solid #cbd5d1',
                borderRadius: '12px',
                background: '#f0f8f5',
                color: '#17231f',
              }}
            >
              <h3 style={{ marginTop: 0 }}>PM2.5 Forecast</h3>

              <p>
                <strong>Location:</strong> {forecast.latitude},{' '}
                {forecast.longitude}
              </p>

              <p>
                <strong>Source:</strong> {forecast.source}
              </p>

              {forecastLoading ? (
                <p>Loading forecast...</p>
              ) : forecast.region === 'Delhi' ? (
                <div>
                  <p style={{ color: '#15803d', fontWeight: 'bold' }}>
                    Delhi Random Forest Prediction
                  </p>

                  <div
                    style={{
                      padding: '20px',
                      borderRadius: '10px',
                      background: 'white',
                      border: '1px solid #d8e3de',
                      marginTop: '12px',
                    }}
                  >
                    <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                      Next-hour PM2.5 prediction
                    </p>

                    <strong style={{ fontSize: '30px' }}>
                      {Number(forecast.prediction?.prediction).toFixed(1)}
                    </strong>

                    <p style={{ margin: '4px 0' }}>µg/m³ PM2.5</p>
                    {(() => {
                      const aqi = calculateAqiFromPm25(
                        Number(forecast.prediction?.prediction)
                      )

                      if (aqi === null) return null

                      const category = getAqiCategory(aqi)

                      return (
                        <div style={{ marginTop: '18px' }}>
                          <p style={{ marginBottom: '4px' }}>
                            Estimated PM2.5-based AQI
                          </p>

                          <strong
                            style={{
                              fontSize: '28px',
                              color: category.color,
                            }}
                          >
                            {aqi}
                          </strong>

                          <p
                            style={{ color: category.color, marginTop: '4px' }}
                          >
                            {category.label}
                          </p>
                        </div>
                      )
                    })()}

                    <p style={{ fontSize: '13px', color: '#52615b' }}>
                      Predicted for: {forecast.prediction?.prediction_for}
                    </p>

                    <p style={{ fontSize: '13px', color: '#52615b' }}>
                      Model: {forecast.prediction?.model}
                    </p>
                  </div>

                  <div
                    style={{
                      marginTop: '12px',
                      padding: '14px',
                      background: 'white',
                      borderRadius: '10px',
                      border: '1px solid #d8e3de',
                    }}
                  >
                    <strong>Nearest DPCC Monitoring Station</strong>

                    <p>{forecast.station?.name}</p>

                    <p style={{ fontSize: '13px', color: '#52615b' }}>
                      Distance: {forecast.station?.distance_km} km
                    </p>

                    <p style={{ fontSize: '13px', color: '#52615b' }}>
                      Observations used: {forecast.station?.observation_count}
                    </p>
                  </div>
                </div>
              ) : forecast.forecasts?.length > 0 ? (
                <>
                  <p style={{ fontSize: '13px', color: '#52615b' }}>
                    Provider-generated forecast from Open-Meteo Air Quality API.
                  </p>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '12px',
                      marginTop: '16px',
                    }}
                  >
                    {forecast.forecasts.slice(0, 6).map((item) => (
                      <div
                        key={item.time}
                        style={{
                          padding: '14px',
                          borderRadius: '10px',
                          background: 'white',
                          border: '1px solid #d8e3de',
                        }}
                      >
                        <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                          {item.time.replace('T', ' ')}
                        </p>

                        <strong style={{ fontSize: '22px' }}>
                          {Number(item.pm2_5).toFixed(1)}
                        </strong>

                        <p style={{ margin: '4px 0 0', fontSize: '12px' }}>
                          µg/m³ PM2.5
                        </p>
                      </div>
                    ))}
                  </div>
                </>
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
  )
}
