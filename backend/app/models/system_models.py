"""
System models for SafeSched simulation engine.
"""
from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field

class ProcessStatus(str, Enum):
    RUNNING = "RUNNING"
    WAITING = "WAITING"
    BLOCKED = "BLOCKED"
    TERMINATED = "TERMINATED"

class ProcessState(BaseModel):
    pid: str
    allocation: List[int]
    max_demand: List[int]
    need: List[int]
    status: ProcessStatus


class SystemState(BaseModel):
    processes: List[ProcessState]
    total_resources: List[int]
    available: List[int]
    allocation_matrix: List[List[int]]
    max_matrix: List[List[int]]
    need_matrix: List[List[int]]
    request_queue: List["Request"]
    event_log: List["Event"]
    seed: Optional[int] = None

# Fix forward references for Pydantic v2
from app.models.event_models import Request, Event
SystemState.model_rebuild()
