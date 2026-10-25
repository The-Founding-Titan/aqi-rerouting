import os
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import requests

app = FastAPI(title="AQI Predictor API")

frontend_url = os.getenv(
    "FRONTEND_URL",
    "http://localhost:5173",
).rstrip("/")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

AQI_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"


@app.get("/")
def home():
    return {"message": "AQI Predictor API is running"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/aqi")
def get_aqi(
    latitude: float = Query(23.3441, ge=-90, le=90),
    longitude: float = Query(85.3096, ge=-180, le=180),
):
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,ozone",
        "timezone": "auto",
    }

    try:
        response = requests.get(AQI_URL, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()

        current = data.get("current")
        if not current:
            raise HTTPException(
                status_code=502,
                detail="AQI data is currently unavailable for this location.",
            )

        return {
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
            "timezone": data.get("timezone"),
            "source": "Open-Meteo Air Quality API",
            "data_type": "model-based current estimate",
            "current": current,
        }

    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail="Could not retrieve AQI data. Please try again later.",
        )


@app.get("/api/forecast")
def get_forecast(
    latitude: float = Query(23.3441, ge=-90, le=90),
    longitude: float = Query(85.3096, ge=-180, le=180),
):
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "pm2_5",
        "forecast_days": 1,
        "timezone": "auto",
    }

    try:
        response = requests.get(
            AQI_URL,
            params=params,
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        values = hourly.get("pm2_5", [])

        if not times or len(times) != len(values):
            raise HTTPException(
                status_code=502,
                detail="Hourly PM2.5 forecast is unavailable.",
            )

        from datetime import datetime

        now = datetime.now().astimezone()
        forecasts = []

        for time_str, value in zip(times, values):
            if value is None:
                continue

            forecast_time = datetime.fromisoformat(time_str)

            # Compare local wall-clock times in the location's timezone.
            # The API timestamps are local times without a UTC offset.
            if forecast_time.replace(tzinfo=None) > now.replace(tzinfo=None):
                forecasts.append(
                    {
                        "time": time_str,
                        "pm2_5": value,
                    }
                )

        return {
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
            "timezone": data.get("timezone"),
            "source": "Open-Meteo Air Quality API",
            "data_type": "provider-generated hourly forecast",
            "pollutant": "PM2.5",
            "unit": "µg/m³",
            "forecasts": forecasts,
        }

    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail="Could not retrieve the air-quality forecast.",
        )
