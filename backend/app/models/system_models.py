"""
System models for SafeSched simulation engine.
"""
from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field
from app.models.resource_models import ResourceState, Checkpoint

class ProcessStatus(str, Enum):
    RUNNING = "RUNNING"
    WAITING = "WAITING"
    BLOCKED = "BLOCKED"
    SUSPENDED = "SUSPENDED"
    TERMINATED = "TERMINATED"

class ProcessState(BaseModel):
    pid: str
    allocation: List[int]
    max_demand: List[int]
    need: List[int]
    status: ProcessStatus
    priority: int = 0
    rollback_count: int = 0  # Number of times this process has been rolled back
    dependents: int = 0      # Number of processes depending on this one (for future use)
    criticality: int = 1     # 1=normal, higher=more critical
    user: str = "default"   # User/group for fairness


class SystemState(BaseModel):
    processes: List[ProcessState]
    resources: Optional[List[ResourceState]] = None  # New: detailed resource objects
    total_resources: List[int]
    available: List[int]
    allocation_matrix: List[List[int]]
    max_matrix: List[List[int]]
    need_matrix: List[List[int]]
    request_queue: List["Request"] = []
    event_log: List["Event"]
    checkpoints: Optional[List[Checkpoint]] = []  # New: checkpoint history

    def sync_resource_states(self, resources: List[ResourceState]):
        """Update the resource states in the system."""
        self.resources = resources
    seed: Optional[int] = None

# Fix forward references for Pydantic v2
from app.models.event_models import Request, Event
SystemState.model_rebuild()
