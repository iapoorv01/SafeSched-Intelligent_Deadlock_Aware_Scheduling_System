class SimulationMetrics:
    """Lightweight metrics for real-world observability."""
    def __init__(self):
        self.steps = 0
        self.grants = 0
        self.denials = 0
        self.deadlocks = 0
        self.recoveries = 0
        self.checkpoints = 0

    def as_dict(self):
        return {
            "steps": self.steps,
            "grants": self.grants,
            "denials": self.denials,
            "deadlocks": self.deadlocks,
            "recoveries": self.recoveries,
            "checkpoints": self.checkpoints,
        }
from app.core.banker import banker_safety_check
"""
Event-driven simulation engine for SafeSched.
"""
from typing import List, Optional
import random
from app.models.system_models import SystemState, ProcessState
from app.models.resource_models import ResourceState, Checkpoint
from app.core.request_queue import RequestQueue
from app.models.event_models import Request, Event, EventType

class SimulationEngine:
    def compute_cost(self, proc):
        """
        Compute recovery cost for a process based on held resources, wait time, and priority.
        Lower cost means better candidate for preemption/termination.
        """
        held_resources = sum(proc.allocation)
        # Wait time: estimate from request_queue (if any request exists for this process)
        wait_time = 0
        for qr in getattr(self.request_queue, '_queue', []):
            if qr.request.process_id == proc.pid:
                # Use the time since the request was added, if available
                if hasattr(qr, 'timestamp') and qr.timestamp is not None:
                    import time
                    wait_time = int(time.time() - qr.timestamp)
                break
        # Priority: use attribute if present, else 0 (lower value = higher priority)
        priority = getattr(proc, 'priority', 0)
        # Weighted sum: held_resources + 2*wait_time + 3*priority
        return held_resources + 2 * wait_time + 3 * priority

    def select_victim(self, deadlocked_pids):
        """
        Select the optimal process to recover (lowest cost).
        """
        candidates = [p for p in self.state.processes if p.pid in deadlocked_pids]
        if not candidates:
            return None
        costs = [(self.compute_cost(p), p) for p in candidates]
        costs.sort(key=lambda x: x[0])
        return costs[0][1].pid

    def hybrid_decision_policy(self, req):
        """
        Hybrid policy: 1) Banker's safety check, 2) risk scoring (stub), 3) policy decision.
        Returns: 'GRANT', 'DELAY', or 'REORDER'.
        """
        # 1. Banker's safety check
        temp_state = self.state.model_copy(deep=True)
        pid = req.process_id
        for i, val in enumerate(req.resource_vector):
            temp_state.available[i] -= val
            proc = next(p for p in temp_state.processes if p.pid == pid)
            proc.allocation[i] += val
            proc.need[i] -= val
        safe = banker_safety_check(temp_state)["safe"]
        # 2. Risk scoring (stub: always 0)
        risk_score = 0
        # 3. Policy: grant if safe, else delay
        if safe:
            return "GRANT"
        elif risk_score < 5:
            return "DELAY"
        else:
            return "REORDER"

    def __init__(self, state: SystemState, queue_config=None, plugin_hooks=None):
        self.state = state
        self.event_log = state.event_log
        if state.seed is not None:
            random.seed(state.seed)
        self.request_queue = RequestQueue(**(queue_config or {}))
        for req in getattr(state, 'request_queue', []):
            self.request_queue.add_request(req)
        self.metrics = SimulationMetrics()
        self.plugin_hooks = plugin_hooks or {}

    def run_auto(self, steps: int = 1):
        """
        Runs the simulation for N steps, logging each step.
        """
        for _ in range(steps):
            self.step()
            self.log_event(EventType.RELEASE, None, [0]*len(self.state.available), details={"action": "auto_step_marker"})

    def replay(self, event_log: list):
        """
        Replay the scenario from a given event log (deterministic replay).
        """
        # Reset state to initial (assume initial state is stored or reconstructable)
        # For now, just clear allocations and available, then replay events
        for proc in self.state.processes:
            proc.allocation = [0]*len(proc.allocation)
            proc.need = proc.max_demand[:]
        self.state.available = self.state.total_resources[:]
        self.state.request_queue.clear()
        self.event_log.clear()
        for event in event_log:
            if event.type == EventType.REQUEST:
                self.submit_request(event.process_id, event.resource_vector)
            elif event.type == EventType.GRANT:
                self.grant_request(event.process_id)
            elif event.type == EventType.WAIT:
                self.deny_request(event.process_id)
            elif event.type == EventType.RELEASE:
                self.release_resources(event.process_id)
            elif event.type == EventType.DEADLOCK:
                # Deadlock events are informational
                self.log_event(EventType.DEADLOCK, event.process_id, event.resource_vector, details=event.details)

    def submit_request(self, pid: str, request_vector: List[int], priority: int = 0):
        req = Request(process_id=pid, resource_vector=request_vector)
        self.request_queue.add_request(req, priority=priority)
        self.state.request_queue = self.request_queue.as_list()
        self.log_event(EventType.REQUEST, pid, request_vector, details={"action": "submit_request", "priority": priority})

    def grant_request(self, pid: str):
        req = next((r for r in self.request_queue.as_list() if r.process_id == pid), None)
        if req:
            for i, val in enumerate(req.resource_vector):
                self.state.available[i] -= val
                proc = next(p for p in self.state.processes if p.pid == pid)
                proc.allocation[i] += val
                proc.need[i] -= val
            # Remove from advanced queue
            self.request_queue._queue = [qr for qr in self.request_queue._queue if qr.request.process_id != pid]
            self.state.request_queue = self.request_queue.as_list()
            self.log_event(EventType.GRANT, pid, req.resource_vector, details={"action": "grant_request"})

    def deny_request(self, pid: str):
        req = next((r for r in self.request_queue.as_list() if r.process_id == pid), None)
        if req:
            self.request_queue._queue = [qr for qr in self.request_queue._queue if qr.request.process_id != pid]
            self.state.request_queue = self.request_queue.as_list()
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
        self.metrics.steps += 1
        if self.plugin_hooks.get("pre_step"):
            self.plugin_hooks["pre_step"](self)
        self.request_queue.step_aging()
        self.state.request_queue = self.request_queue.as_list()
        # Hybrid scheduling: always process highest-priority eligible request using policy
        next_req = None
        max_policy_iter = 100
        for idx, req in enumerate(self.request_queue.as_list()):
            if idx > max_policy_iter:
                break  # Prevent infinite loop
            pid = req.process_id
            can_grant = all(req.resource_vector[i] <= self.state.available[i] for i in range(len(self.state.available)))
            if can_grant:
                policy = self.hybrid_decision_policy(req)
                if policy == "GRANT":
                    next_req = req
                    break
                elif policy == "DELAY":
                    continue
                elif policy == "REORDER":
                    self.request_queue._queue = [qr for qr in self.request_queue._queue if qr.request.process_id != pid] + [qr for qr in self.request_queue._queue if qr.request.process_id == pid]
        if next_req:
            self.grant_request(next_req.process_id)
            self.metrics.grants += 1
            self.create_checkpoint(description="Auto-checkpoint after grant")
        elif self.request_queue._queue:
            req = self.request_queue._queue[0].request
            self.deny_request(req.process_id)
            self.metrics.denials += 1
        from app.core.deadlock_detector import matrix_deadlock_detection
        deadlocked = matrix_deadlock_detection(self.state)
        if deadlocked:
            self.metrics.deadlocks += 1
            self.log_event(EventType.DEADLOCK, None, [0]*len(self.state.available), details={"deadlocked": deadlocked})
            self.recover_from_deadlock(deadlocked)
        if self.plugin_hooks.get("post_step"):
            self.plugin_hooks["post_step"](self)

    def recover_from_deadlock(self, deadlocked_pids):
        """
        Iterative cost-based recovery: preempt or terminate lowest-cost process, checkpoint before each recovery, repeat until system is safe.
        """
        if not deadlocked_pids:
            return
        from app.core.deadlock_detector import matrix_deadlock_detection
        recovery_count = 0
        while deadlocked_pids:
            self.create_checkpoint(description=f"Pre-recovery checkpoint {recovery_count+1}")
            victim = self.select_victim(deadlocked_pids)
            if victim is not None:
                # Try preemption first, then termination if not possible
                preempted = self.preempt_process(victim)
                if preempted:
                    self.metrics.recoveries += 1
                    self.log_event(EventType.RELEASE, victim, [0]*len(self.state.available), details={"action": "recovery_preempt", "cost_based": True, "iterative": True})
                else:
                    self.terminate_process(victim)
                    self.metrics.recoveries += 1
                    self.log_event(EventType.RELEASE, victim, [0]*len(self.state.available), details={"action": "recovery_terminate", "cost_based": True, "iterative": True})
            # Re-check for deadlock after each recovery
            deadlocked_pids = matrix_deadlock_detection(self.state)
            recovery_count += 1

    def preempt_process(self, pid):
        """
        Preempt resources from a process (simulate suspension, not termination).
        Returns True if preemption was performed, False if not possible.
        """
        proc = next((p for p in self.state.processes if p.pid == pid), None)
        if proc is None:
            return False
        # Only preempt if process is not already terminated or suspended
        from app.models.system_models import ProcessStatus
        if hasattr(proc, 'status') and proc.status in [ProcessStatus.TERMINATED, ProcessStatus.SUSPENDED]:
            return False
        # Release all resources but mark as SUSPENDED
        released = proc.allocation[:]
        for i, val in enumerate(released):
            self.state.available[i] += val
            proc.allocation[i] = 0
            proc.need[i] = proc.max_demand[i]
        proc.status = ProcessStatus.SUSPENDED
        # Remove any outstanding requests
        self.request_queue._queue = [qr for qr in self.request_queue._queue if qr.request.process_id != pid]
        self.state.request_queue = self.request_queue.as_list()
        return True

    def terminate_process(self, pid):
        proc = next((p for p in self.state.processes if p.pid == pid), None)
        if proc:
            # Release all resources
            for i, val in enumerate(proc.allocation):
                self.state.available[i] += val
                proc.allocation[i] = 0
                proc.need[i] = proc.max_demand[i]
            from app.models.system_models import ProcessStatus
            proc.status = ProcessStatus.TERMINATED
            # Remove any outstanding requests
            self.request_queue._queue = [qr for qr in self.request_queue._queue if qr.request.process_id != pid]
            self.state.request_queue = self.request_queue.as_list()

    def rollback_to_last_checkpoint(self):
        """
        Rollback to last checkpoint (if any), with loop prevention (max_rollback).
        """
        max_rollback = 5
        rollback_count = 0
        while self.state.checkpoints and rollback_count < max_rollback:
            last_cp = self.state.checkpoints[-1]
            # Restore system state
            restored = SystemState(**last_cp.system_state)
            self.state.processes = restored.processes
            self.state.total_resources = restored.total_resources
            self.state.available = restored.available
            self.state.allocation_matrix = restored.allocation_matrix
            self.state.max_matrix = restored.max_matrix
            self.state.need_matrix = restored.need_matrix
            self.state.request_queue = restored.request_queue
            self.state.event_log = restored.event_log
            rollback_count += 1
            # If system is now safe, break
            from app.core.deadlock_detector import matrix_deadlock_detection
            if not matrix_deadlock_detection(self.state):
                return True
            # Otherwise, pop this checkpoint and try previous
            self.state.checkpoints.pop()
        return False

    def create_checkpoint(self, description: Optional[str] = None):
        import time
        max_checkpoints = 10
        cp = Checkpoint(
            checkpoint_id=f"cp_{len(self.state.checkpoints or [])+1}",
            timestamp=time.time(),
            system_state=self.state.model_dump(),
            event_log=[e.model_dump() for e in self.event_log],
            description=description
        )
        if self.state.checkpoints is None:
            self.state.checkpoints = []
        self.state.checkpoints.append(cp)
        # Retain only the most recent max_checkpoints
        if len(self.state.checkpoints) > max_checkpoints:
            self.state.checkpoints = self.state.checkpoints[-max_checkpoints:]
        self.metrics.checkpoints += 1
        return cp

    def get_metrics(self):
        return self.metrics.as_dict()

    def get_current_state(self) -> SystemState:
        return self.state

    def get_event_log(self) -> List[Event]:
        # Always return the state's event_log for consistency
        return self.state.event_log

    def log_event(self, event_type: EventType, pid: Optional[str], resource_vector: List[int], details=None):
        import time
        event = Event(
            event_id=f"evt_{len(self.state.event_log)+1}",
            timestamp=time.time(),
            type=event_type,
            process_id=pid or "-",
            resource_vector=resource_vector,
            details=details or {}
        )
        self.state.event_log.append(event)
        # Keep self.event_log always in sync
        self.event_log = self.state.event_log
