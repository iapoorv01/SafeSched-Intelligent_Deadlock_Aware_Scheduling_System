"""
ResourceState and Checkpoint models for SafeSched.
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class ResourceState(BaseModel):
    resource_id: str
    total: int
    available: int
    allocated: int = 0
    type: Optional[str] = None  # e.g., CPU, Memory, IO, etc.
    meta: Optional[Dict[str, Any]] = None

class Checkpoint(BaseModel):
    checkpoint_id: str
    timestamp: float
    system_state: Dict[str, Any]  # Full dump of SystemState
    event_log: List[Dict[str, Any]]
    description: Optional[str] = None
