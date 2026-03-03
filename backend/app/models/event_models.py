"""
Event models for SafeSched simulation engine.
"""
from typing import List, Optional, Dict, Any
from enum import Enum
from pydantic import BaseModel

class EventType(str, Enum):
    REQUEST = "REQUEST"
    GRANT = "GRANT"
    WAIT = "WAIT"
    RELEASE = "RELEASE"
    DEADLOCK = "DEADLOCK"

class Event(BaseModel):
    event_id: str
    timestamp: float
    type: EventType
    process_id: str
    resource_vector: List[int]
    details: Optional[Dict[str, Any]] = None

class Request(BaseModel):
    process_id: str
    resource_vector: List[int]
    timestamp: Optional[float] = None
