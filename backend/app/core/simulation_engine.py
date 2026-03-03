"""
Event-driven simulation engine for SafeSched.
"""
from typing import List, Optional
import random
from app.models.system_models import SystemState, ProcessState
from app.models.event_models import Request, Event, EventType

class SimulationEngine:
    def __init__(self, state: SystemState):
        self.state = state
        self.event_log = []
        if state.seed is not None:
            random.seed(state.seed)

    def submit_request(self, pid: str, request_vector: List[int]):
        req = Request(process_id=pid, resource_vector=request_vector)
        self.state.request_queue.append(req)
        self.log_event(EventType.REQUEST, pid, request_vector, details={"action": "submit_request"})

    def grant_request(self, pid: str):
        req = next((r for r in self.state.request_queue if r.process_id == pid), None)
        if req:
            for i, val in enumerate(req.resource_vector):
                self.state.available[i] -= val
                proc = next(p for p in self.state.processes if p.pid == pid)
                proc.allocation[i] += val
                proc.need[i] -= val
            self.state.request_queue.remove(req)
            self.log_event(EventType.GRANT, pid, req.resource_vector, details={"action": "grant_request"})

    def deny_request(self, pid: str):
        req = next((r for r in self.state.request_queue if r.process_id == pid), None)
        if req:
            self.state.request_queue.remove(req)
            self.log_event(EventType.WAIT, pid, req.resource_vector, details={"action": "deny_request"})

    def release_resources(self, pid: str):
        proc = next(p for p in self.state.processes if p.pid == pid)
        released = proc.allocation[:]
        for i, val in enumerate(released):
            self.state.available[i] += val
            proc.allocation[i] = 0
            proc.need[i] = proc.max_demand[i]
        self.log_event(EventType.RELEASE, pid, released, details={"action": "release_resources"})

    def step(self):
        # Deterministic: always process first request in queue
        if self.state.request_queue:
            req = self.state.request_queue[0]
            pid = req.process_id
            proc = next(p for p in self.state.processes if p.pid == pid)
            can_grant = all(req.resource_vector[i] <= self.state.available[i] for i in range(len(self.state.available)))
            if can_grant:
                self.grant_request(pid)
            else:
                self.deny_request(pid)
        # Deadlock detection
        from app.core.deadlock_detector import matrix_deadlock_detection
        deadlocked = matrix_deadlock_detection(self.state)
        if deadlocked:
            self.log_event(EventType.DEADLOCK, None, [0]*len(self.state.available), details={"deadlocked": deadlocked})

    def get_current_state(self) -> SystemState:
        return self.state

    def get_event_log(self) -> List[Event]:
        return self.event_log

    def log_event(self, event_type: EventType, pid: Optional[str], resource_vector: List[int], details=None):
        import time
        event = Event(
            event_id=f"evt_{len(self.event_log)+1}",
            timestamp=time.time(),
            type=event_type,
            process_id=pid or "-",
            resource_vector=resource_vector,
            details=details or {}
        )
        self.event_log.append(event)
        self.state.event_log.append(event)
