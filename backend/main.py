import os
import requests
import time
import threading

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# Support both execution styles:
# 1. uvicorn backend.main:app (from project root)
# 2. uvicorn main:app (from backend directory)
try:
    from backend.delhi_ml.delhi_service import DelhiPredictionService
    from backend.geo.boundary_service import is_inside_delhi
except ModuleNotFoundError:
    from delhi_ml.delhi_service import DelhiPredictionService
    from geo.boundary_service import is_inside_delhi
try:
    from backend.services.dpcc_service import fetch_all_valid_stations
except ModuleNotFoundError:
    from services.dpcc_service import fetch_all_valid_stations


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the Delhi ML model once when the API starts.
    app.state.delhi_prediction_service = DelhiPredictionService()
    yield


app = FastAPI(
    title="AQI Predictor API",
    lifespan=lifespan,
)

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
# Open-Meteo response cache
OPEN_METEO_CACHE_TTL = 600  # 10 minutes

open_meteo_cache = {}
open_meteo_cache_lock = threading.Lock()


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
    # Delhi locations use our Random Forest model.
    if is_inside_delhi(latitude, longitude):
        try:
            service = app.state.delhi_prediction_service

            return {
                "latitude": latitude,
                "longitude": longitude,
                "region": "Delhi",
                "source": "DPCC + Delhi Random Forest ML Model",
                "data_type": "next-hour PM2.5 prediction",
                **service.predict(latitude, longitude),
            }

        except Exception as error:
            raise HTTPException(
                status_code=502,
                detail=f"Delhi forecast failed: {str(error)}",
            )
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "pm2_5",
        "forecast_days": 2,
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
        print("SERVER NOW:", now)
        print("FORECAST TIMEZONE:", data.get("timezone"))
        print("FIRST HOURLY TIMES:", times[:5])
        print("LAST HOURLY TIMES:", times[-5:])
        forecasts = []

        for time_str, value in zip(times, values):
            if value is None:
                continue

            forecast_time = datetime.fromisoformat(time_str)

            # Compare local wall-clock times in the location's timezone.
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


@app.get("/api/delhi/pm25-prediction")
def get_delhi_pm25_prediction(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
):
    try:
        service = app.state.delhi_prediction_service

        return {
            "source": "DPCC + Delhi Random Forest ML Model",
            "data_type": "next-hour PM2.5 prediction",
            **service.predict(latitude, longitude),
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Delhi PM2.5 prediction failed: {str(error)}",
        )


@app.get("/api/pm25-prediction")
def get_pm25_prediction(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
):
    # Route locations inside NCT Delhi to DPCC + ML.
    if is_inside_delhi(latitude, longitude):
        try:
            service = app.state.delhi_prediction_service

            return {
                "latitude": latitude,
                "longitude": longitude,
                "region": "Delhi",
                "source": "DPCC + Delhi Random Forest ML Model",
                "data_type": "next-hour PM2.5 prediction",
                **service.predict(latitude, longitude),
            }

        except Exception as error:
            raise HTTPException(
                status_code=502,
                detail=f"Delhi PM2.5 prediction failed: {str(error)}",
            )

        # Locations outside Delhi use Open-Meteo.
    cache_key = (round(latitude, 3), round(longitude, 3))

    with open_meteo_cache_lock:
        cached = open_meteo_cache.get(cache_key)

        if cached and time.monotonic() - cached["timestamp"] < OPEN_METEO_CACHE_TTL:
            print("OPEN-METEO CACHE HIT")
            return cached["data"]

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "pm2_5",
        "timezone": "auto",
    }

    try:
        response = requests.get(AQI_URL, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()

        current = data.get("current")

        if not current or current.get("pm2_5") is None:
            raise HTTPException(
                status_code=502,
                detail="Current PM2.5 data is unavailable.",
            )

        result = {
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
            "region": "Outside Delhi",
            "source": "Open-Meteo Air Quality API",
            "data_type": "current PM2.5 estimate",
            "pollutant": "PM2.5",
            "unit": "µg/m³",
            "current": current,
        }

        with open_meteo_cache_lock:
            open_meteo_cache[cache_key] = {
                "timestamp": time.monotonic(),
                "data": result,
            }

        return result

    except requests.RequestException as error:
        print(f"Open-Meteo request failed: {repr(error)}")
        raise HTTPException(
            status_code=502,
            detail=f"Open-Meteo request failed: {str(error)}",
        )


@app.get("/api/delhi/stations")
def get_delhi_stations():
    try:
        result = fetch_all_valid_stations()

        stations = []

        for station in result["valid_stations"]:
            latest = station["observations"][-1]

            stations.append(
                {
                    "name": station["station"],
                    "key": station["station_key"],
                    "latitude": station["latitude"],
                    "longitude": station["longitude"],
                    "pm25": latest["pm25"],
                    "timestamp": latest["timestamp"],
                    "observation_count": station["observation_count"],
                }
            )

        return {
            "source": "DPCC",
            "pollutant": "PM2.5",
            "unit": "µg/m³",
            "stations": stations,
            "available_station_count": len(stations),
            "failed_stations": result["failed_stations"],
        }

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Could not retrieve Delhi station data: {str(error)}",
        )
