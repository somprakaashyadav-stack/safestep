"""
Pydantic Schemas for SafeStep REST API
"""

from pydantic import BaseModel, Field
from typing import List, Optional

class Coordinates(BaseModel):
    lat: float
    lng: float

class RouteRequest(BaseModel):
    origin: Coordinates
    destination: Coordinates
    departure_hour: int = Field(default=23, ge=0, le=23, description="0-23 24h clock")
    priority: str = Field(default="safe", description="'safe' or 'fast'")

class SegmentRiskOutput(BaseModel):
    segment_id: str
    safety_score: float
    risk_index: float
    category: str
    color: str
    xai_reasons: List[str]

class RouteOption(BaseModel):
    id: str
    title: str
    safety_score: float
    distance_km: float
    duration_mins: float
    is_recommended: bool
    coordinates: List[List[float]]
    features: List[str]
    explanation: str

class RouteResponse(BaseModel):
    origin: Coordinates
    destination: Coordinates
    departure_hour: int
    routes: List[RouteOption]

class IncidentReportCreate(BaseModel):
    category: str
    description: Optional[str] = None
    lat: float
    lng: float
    is_anonymous: bool = True

class SafeShelterItem(BaseModel):
    id: int
    name: str
    type: str # police, hospital, pharma
    lat: float
    lng: float
    operating_hours: str
    contact: Optional[str] = None
