"""
SafeStep: FastAPI Backend Entrypoint
Predictive Women's Journey Safety & Smart Urban Intelligence Engine
"""

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
try:
    from backend.routes import router
except ImportError:
    from routes import router

app = FastAPI(
    title="SafeStep AI Safety Engine API",
    description="Asynchronous REST API for predictive journey routing, street audits, and emergency response",
    version="1.0.0"
)

# Enable complete CORS for web browser client
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

@app.get("/")
@app.get("/health")
@app.get("/api/v1/health")
def health_check():
    return {
        "status": "online",
        "service": "SafeStep AI Navigation Engine",
        "engine": "Scikit-Learn Time-Dependent Risk Regressor + OSRM Routing Bridge",
        "version": "2.0.0",
        "active_mode": "Global Dynamic Routing (OSRM & OpenStreetMap Nominatim)"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
