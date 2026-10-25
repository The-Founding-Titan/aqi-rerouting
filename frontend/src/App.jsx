import { useCallback, useEffect, useState } from 'react'
import './App.css'

import MapView from './MapView'
const API = 'http://127.0.0.1:8000/api/aqi'

function getCategory(aqi) {
  if (aqi == null) return { label: 'Unavailable', color: '#64748b' }
  if (aqi <= 50) return { label: 'Good', color: '#16a34a' }
  if (aqi <= 100) return { label: 'Moderate', color: '#ca8a04' }
  if (aqi <= 150)
    return { label: 'Unhealthy for Sensitive Groups', color: '#ea580c' }
  if (aqi <= 200) return { label: 'Unhealthy', color: '#dc2626' }
  if (aqi <= 300) return { label: 'Very Unhealthy', color: '#9333ea' }
  return { label: 'Hazardous', color: '#7f1d1d' }
}

function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchAQI = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(API)
      if (!response.ok) {
        throw new Error('Unable to retrieve AQI data. Please try again.')
      }

      const result = await response.json()
      if (!result.current || result.current.us_aqi == null) {
        throw new Error('AQI data is unavailable for this location.')
      }

      setData(result)
    } catch (err) {
      setError(err.message || 'Could not connect to the backend.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAQI()
  }, [fetchAQI])

  const current = data?.current
  const aqi = current?.us_aqi
  const category = getCategory(aqi)

  const pollutants = [
    {
      name: 'PM2.5',
      key: 'pm2_5',
      unit: 'µg/m³',
      description: 'Fine particles',
    },
    {
      name: 'PM10',
      key: 'pm10',
      unit: 'µg/m³',
      description: 'Coarse particles',
    },
    {
      name: 'Ozone',
      key: 'ozone',
      unit: 'µg/m³',
      description: 'Ground-level ozone',
    },
    {
      name: 'Nitrogen dioxide',
      key: 'nitrogen_dioxide',
      unit: 'µg/m³',
      description: 'Traffic-related pollutant',
    },
    {
      name: 'Carbon monoxide',
      key: 'carbon_monoxide',
      unit: 'µg/m³',
      description: 'Combustion pollutant',
    },
  ]

  return (
    <main className="dashboard">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-icon">✳</span>
          <span>AirSense</span>
        </a>
        <span className="live-label">
          <span className="live-dot" />
          AIR QUALITY MONITOR
        </span>
      </header>

      <section className="intro">
        <p className="eyebrow">BREATHE BETTER. TRAVEL SMARTER.</p>
        <h1>
          Air quality, <span>at a glance.</span>
        </h1>
        <p className="subtitle">
          Monitor pollution levels today. Cleaner route recommendations are
          coming next.
        </p>
      </section>

      {error && (
        <section className="error-box">
          <p>{error}</p>
          <button onClick={fetchAQI}>Try again</button>
        </section>
      )}

      <section className="overview">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CURRENT CONDITIONS</p>
            <h2>Ranchi, Jharkhand</h2>
            <p className="muted">Approximate location · India</p>
          </div>
          <button
            className="refresh-button"
            onClick={fetchAQI}
            disabled={loading}
          >
            <span>{loading ? '↻' : '⟳'}</span>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        <div className="aqi-card">
          <div className="aqi-main">
            <p className="card-label">US AIR QUALITY INDEX</p>
            {loading && !data ? (
              <div className="skeleton aqi-skeleton" />
            ) : (
              <div className="aqi-number" style={{ color: category.color }}>
                {aqi ?? '—'}
              </div>
            )}
            <span
              className="category-pill"
              style={{
                color: category.color,
                backgroundColor: `${category.color}18`,
              }}
            >
              {loading && !data ? 'Loading AQI...' : category.label}
            </span>
            <p className="aqi-note">
              {aqi == null
                ? 'Waiting for air quality data.'
                : aqi <= 50
                  ? 'Air quality is satisfactory.'
                  : aqi <= 100
                    ? 'Sensitive people may need to take care.'
                    : aqi <= 150
                      ? 'Sensitive groups may experience health effects.'
                      : 'Consider reducing prolonged outdoor exertion.'}
            </p>
          </div>

          <div className="aqi-side">
            <div className="gauge">
              <div
                className="gauge-value"
                style={{
                  background: `conic-gradient(${category.color} ${
                    Math.min(aqi ?? 0, 500) / 5
                  }%, #e5e7eb 0)`,
                }}
              >
                <div className="gauge-inner">
                  <span>US AQI</span>
                  <strong>{aqi ?? '—'}</strong>
                </div>
              </div>
            </div>
            <p>Scale: 0–500</p>
          </div>
        </div>
      </section>

      <section className="pollutants-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">WHAT'S IN THE AIR?</p>
            <h2>Pollutant breakdown</h2>
          </div>
          <span className="unit-label">Current estimates</span>
        </div>

        <div className="pollutant-grid">
          {pollutants.map((pollutant) => {
            const value = current?.[pollutant.key]

            return (
              <article className="pollutant-card" key={pollutant.key}>
                <div className="pollutant-icon">◉</div>
                <p className="pollutant-name">{pollutant.name}</p>
                <div className="pollutant-value">
                  {loading && !data ? (
                    <span className="skeleton value-skeleton" />
                  ) : value != null ? (
                    value
                  ) : (
                    '—'
                  )}
                  {value != null && (
                    <span className="pollutant-unit">{pollutant.unit}</span>
                  )}
                </div>
                <p className="pollutant-description">{pollutant.description}</p>
              </article>
            )
          })}
        </div>
      </section>
      {/* Interactive Map */}
      <section className="map-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">EXPLORE YOUR AREA</p>
            <h2>Air quality map</h2>
            <p className="muted">Click the map to select a location.</p>
          </div>
        </div>

        <MapView />
      </section>

      <section className="info-strip">
        <div>
          <span className="info-icon">⌁</span>
          <div>
            <strong>Data source</strong>
            <p>Open-Meteo Air Quality API</p>
          </div>
        </div>
        <div>
          <span className="info-icon">◷</span>
          <div>
            <strong>Data timestamp</strong>
            <p>{current?.time ?? (loading ? 'Loading...' : 'Unavailable')}</p>
          </div>
        </div>
      </section>

      <footer>
        <p>
          AQI values are model-based estimates, not direct monitoring-station
          measurements. This dashboard is a prototype, not medical advice.
        </p>
        <span>AirSense · Project Prototype</span>
      </footer>
    </main>
  )
}

export default App
