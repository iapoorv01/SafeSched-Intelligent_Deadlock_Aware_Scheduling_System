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
    def compute_cost(self, proc, explain: bool = False, multi_objective: bool = False):
        """
        Compute ultra-advanced recovery cost for a process.
        Supports:
        - Dynamic/adaptive weights
        - Explainability (breakdown)
        - Multi-objective (vector) cost
        - Historical/temporal cost (moving average)
        - Pluggable cost plugins (external module/user script)
        """
        # --- Dynamic/adaptive weights ---
        weights = getattr(self, 'cost_weights', None)
        if weights is None:
            weights = {
                'held_resources': 1,
                'wait_time': 2,
                'priority': 3,
                'rollback_penalty': 5,
                'dependents': 2,
                'criticality': 4,
                'fairness_penalty': 1,
                'process_age': -2,
                'burstiness': 1,
                'custom_policy_cost': 1
            }
        # --- Resource-type weighting ---
        resource_weights = getattr(self, 'resource_weights', None)
        if resource_weights is None:
            resource_weights = [1] * len(proc.allocation)
        held_resources = sum([a * w for a, w in zip(proc.allocation, resource_weights)])
        # --- Wait time ---
        wait_time = 0
        for qr in getattr(self.request_queue, '_queue', []):
            if qr.request.process_id == proc.pid:
                if hasattr(qr, 'timestamp') and qr.timestamp is not None:
                    import time
                    wait_time = int(time.time() - qr.timestamp)
                break
        priority = getattr(proc, 'priority', 0)
        rollback_penalty = weights['rollback_penalty'] * getattr(proc, 'rollback_count', 0)
        dependents = getattr(proc, 'dependents', 0)
        criticality = getattr(proc, 'criticality', 1)
        # --- Fairness ---
        user = getattr(proc, 'user', 'default')
        user_total = 0
        for p in self.state.processes:
            if getattr(p, 'user', 'default') == user:
                user_total += sum(getattr(p, 'allocation', []))
        fairness_penalty = user_total // max(1, len([p for p in self.state.processes if getattr(p, 'user', 'default') == user]))
        process_age = getattr(proc, 'age', 0)
        burstiness = 0
        if hasattr(self, 'event_log'):
            burstiness = sum(1 for e in self.event_log if getattr(e, 'process_id', None) == proc.pid and getattr(e, 'type', None) == 'REQUEST')
        # --- Pluggable cost plugin (external module/user script) ---
        custom_policy_cost = 0
        if getattr(self, 'custom_cost_policy', None) is not None and callable(self.custom_cost_policy):
            result = self.custom_cost_policy(proc, self)
            if isinstance(result, (int, float)):
                custom_policy_cost = result
            elif isinstance(result, dict):
                custom_policy_cost = result.get('cost', 0)
        # --- Historical/temporal cost (moving average) ---
        if not hasattr(self, '_cost_history'):
            self._cost_history = {}
        prev_cost = self._cost_history.get(proc.pid, None)
        # --- Vector cost for multi-objective ---
        cost_vector = [
            held_resources,
            wait_time,
            priority,
            rollback_penalty,
            dependents,
            criticality,
            fairness_penalty,
            process_age,
            burstiness,
            custom_policy_cost
        ]
        # --- Weighted sum for scalar cost ---
        breakdown = {
            'held_resources': weights['held_resources'] * held_resources,
            'wait_time': weights['wait_time'] * wait_time,
            'priority': weights['priority'] * priority,
            'rollback_penalty': rollback_penalty,
            'dependents': weights['dependents'] * dependents,
            'criticality': weights['criticality'] * criticality,
            'fairness_penalty': weights['fairness_penalty'] * fairness_penalty,
            'process_age': weights['process_age'] * process_age,
            'burstiness': weights['burstiness'] * burstiness,
            'custom_policy_cost': weights['custom_policy_cost'] * custom_policy_cost
        }
        cost = sum(breakdown.values())
        # --- Moving average for historical/temporal cost ---
        alpha = 0.5  # Smoothing factor
        if prev_cost is not None:
            cost = alpha * cost + (1 - alpha) * prev_cost
        self._cost_history[proc.pid] = cost
        # --- Return vector or scalar cost ---
        if multi_objective:
            result = (cost_vector, breakdown) if explain else cost_vector
        else:
            result = (cost, breakdown) if explain else cost
        return result

    def load_external_cost_plugin(self, module_path, function_name='custom_cost_policy'):
        """
        Dynamically load a cost function from an external Python module.
        The function must have signature (proc, engine) -> float|dict.
        """
        import importlib.util
        spec = importlib.util.spec_from_file_location("external_cost_plugin", module_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not load module from {module_path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.custom_cost_policy = getattr(module, function_name)

    def select_victim(self, deadlocked_pids, multi_objective: bool = False):
        """
        Select the optimal process to recover.
        If multi_objective=True, use Pareto optimality (minimize all cost dimensions).
        """
        candidates = [p for p in self.state.processes if p.pid in deadlocked_pids]
        if not candidates:
            return None
        if multi_objective:
            # Pareto front: keep only non-dominated processes
            costs = [(self.compute_cost(p, multi_objective=True), p) for p in candidates]
            # Ensure cost vectors are lists, not tuples
            costs = [((list(vec) if isinstance(vec, (tuple, list)) else [vec]), p) for vec, p in costs]
            pareto = []
            for i, (vec_i, p_i) in enumerate(costs):
                dominated = False
                for j, (vec_j, _) in enumerate(costs):
                    if i != j and all(x >= y for x, y in zip(vec_i, vec_j)) and any(x > y for x, y in zip(vec_i, vec_j)):
                        dominated = True
                        break
                if not dominated:
                    pareto.append((vec_i, p_i))
            # If multiple on Pareto front, pick one with lowest sum
            if pareto:
                pareto.sort(key=lambda x: sum(x[0]))
                return pareto[0][1].pid
            else:
                return costs[0][1].pid
        else:
            costs = [(self.compute_cost(p), p) for p in candidates]
            costs = [(c[0] if isinstance(c, tuple) else c, p) for c, p in costs]
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

    def __init__(
        self,
        state: SystemState,
        queue_config=None,
        plugin_hooks=None,
        custom_cost_policy=None,
        checkpoint_every_n_steps: int = 0,
        max_checkpoints: int = 10,
        checkpoint_retention_policy=None,
        checkpoint_on_events: Optional[list] = None,
        checkpoint_time_window: float = 0.0,
        checkpoint_per_user: bool = False,
        external_checkpoint_hook=None,
        rollback_escalation_hook=None,
        checkpoint_validator=None,
        safe_state_factory=None
    ):
        self.state = state
        self.event_log = state.event_log
        if state.seed is not None:
            random.seed(state.seed)
        self.request_queue = RequestQueue(**(queue_config or {}))
        for req in getattr(state, 'request_queue', []):
            self.request_queue.add_request(req)
        self.metrics = SimulationMetrics()
        self.plugin_hooks = plugin_hooks or {}
        self.custom_cost_policy = custom_cost_policy
        # --- Checkpoint every N steps (events) ---
        self.checkpoint_every_n_steps = checkpoint_every_n_steps if isinstance(checkpoint_every_n_steps, int) and checkpoint_every_n_steps > 0 else 0
        self._step_since_last_checkpoint = 0
        # --- Adaptive checkpointing state ---
        self._adaptive_checkpointing_enabled = False
        self._adaptive_min_n = 1
        self._adaptive_max_n = 100
        self._adaptive_recent_deadlocks = []
        self._adaptive_window = 10  # Number of steps to look back for deadlocks
        # --- Advanced checkpoint retention ---
        self.max_checkpoints = max_checkpoints if isinstance(max_checkpoints, int) and max_checkpoints > 0 else 10
        self.checkpoint_retention_policy = checkpoint_retention_policy
        # --- Event-based checkpointing ---
        # Always ensure checkpoint_on_events is a list
        self.checkpoint_on_events = []
        if checkpoint_on_events is not None:
            self.checkpoint_on_events = list(checkpoint_on_events)
        # --- Time-based retention (optional) ---
        self.checkpoint_time_window = checkpoint_time_window  # seconds, 0 disables
        # --- Per-user retention (optional) ---
        self.checkpoint_per_user = checkpoint_per_user
        # --- External checkpoint trigger (optional) ---
        self.external_checkpoint_hook = external_checkpoint_hook
        # --- Rollback escalation (alert/notify on unrecoverable failure) ---
        self.rollback_escalation_hook = rollback_escalation_hook
        # --- Checkpoint validator (callable: cp -> bool) ---
        self.checkpoint_validator = checkpoint_validator
        # --- Safe state factory (callable: returns SystemState) ---
        self.safe_state_factory = safe_state_factory
        # --- Quarantined checkpoints (ids) ---
        self._quarantined_checkpoints = set()
        # --- Rollback audit trail ---
        self.rollback_audit_trail = []

    def _enforce_checkpoint_retention(self):
        # Ensure checkpoints is always a list
        if self.state.checkpoints is None:
            self.state.checkpoints = []
        # --- Time-based retention (remove checkpoints older than window) ---
        import time
        if self.checkpoint_time_window and self.checkpoint_time_window > 0:
            now = time.time()
            self.state.checkpoints = [cp for cp in self.state.checkpoints if (now - cp.timestamp) <= self.checkpoint_time_window]
        # --- Per-user retention (keep at least one checkpoint per user if enabled) ---
        if self.checkpoint_per_user:
            user_latest = {}
            for cp in reversed(self.state.checkpoints):
                # Try to extract user from checkpoint description or event log (customize as needed)
                user = None
                if cp.description and 'user=' in cp.description:
                    user = cp.description.split('user=')[1].split()[0]
                if not user and cp.event_log:
                    for e in reversed(cp.event_log):
                        if 'user' in e.get('details', {}):
                            user = e['details']['user']
                            break
                if user and user not in user_latest:
                    user_latest[user] = cp
            # Always keep at least one per user
            keep = set(user_latest.values())
            self.state.checkpoints = [cp for cp in self.state.checkpoints if cp in keep or cp in self.state.checkpoints[-self.max_checkpoints:]]
        # --- Custom retention policy (overrides above if present) ---
        if callable(self.checkpoint_retention_policy):
            result = self.checkpoint_retention_policy(self.state.checkpoints, self)
            if isinstance(result, list):
                self.state.checkpoints = result
        else:
            # Default: keep only the last K checkpoints
            if len(self.state.checkpoints) > self.max_checkpoints:
                self.state.checkpoints = self.state.checkpoints[-self.max_checkpoints:]

    def run_auto(self, steps: int = 1):
        """
        Runs the simulation for N steps, logging each step.
        Automatically creates a checkpoint every N steps if configured.
        Supports adaptive checkpointing if enabled.
        """
        for _ in range(steps):
            self.step()
            self.log_event(EventType.RELEASE, None, [0]*len(self.state.available), details={"action": "auto_step_marker"})
            # --- Adaptive checkpointing logic ---
            if self._adaptive_checkpointing_enabled:
                self._update_adaptive_checkpointing()
            # --- Checkpoint every N steps logic ---
            if self.checkpoint_every_n_steps:
                self._step_since_last_checkpoint += 1
                if self._step_since_last_checkpoint >= self.checkpoint_every_n_steps:
                    self.create_checkpoint(description=f"Auto-checkpoint every {self.checkpoint_every_n_steps} steps")
                    self._step_since_last_checkpoint = 0

    def enable_adaptive_checkpointing(self, min_n=1, max_n=100, window=10):
        """
        Enable adaptive checkpointing: frequency adapts to system load and recent deadlocks.
        """
        self._adaptive_checkpointing_enabled = True
        self._adaptive_min_n = min_n
        self._adaptive_max_n = max_n
        self._adaptive_window = window
        self._adaptive_recent_deadlocks = []

    def _update_adaptive_checkpointing(self):
        """
        Adjust checkpoint_every_n_steps based on recent deadlocks and system load.
        """
        # Track recent deadlocks
        if hasattr(self, 'metrics') and hasattr(self.metrics, 'deadlocks'):
            import time
            now = time.time()
            # Remove old deadlocks
            self._adaptive_recent_deadlocks = [t for t in self._adaptive_recent_deadlocks if now - t < self._adaptive_window]
            # If a deadlock just occurred, add timestamp
            if self.metrics.deadlocks > len(self._adaptive_recent_deadlocks):
                self._adaptive_recent_deadlocks.append(now)
        # Adjust frequency: more deadlocks = more frequent checkpoints
        deadlock_rate = len(self._adaptive_recent_deadlocks) / max(1, self._adaptive_window)
        # System load: number of active processes
        active_procs = len([p for p in self.state.processes if getattr(p, 'status', None) != 'TERMINATED'])
        # Example: decrease N if deadlocks or load are high
        n = self._adaptive_max_n
        if deadlock_rate > 0.2:
            n = max(self._adaptive_min_n, self._adaptive_max_n // 4)
        elif active_procs > 10:
            n = max(self._adaptive_min_n, self._adaptive_max_n // 2)
        elif deadlock_rate > 0:
            n = max(self._adaptive_min_n, self._adaptive_max_n // 2)
        self.checkpoint_every_n_steps = n

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
            # Enforce retention after each recovery checkpoint
            self._enforce_checkpoint_retention()
            victim = self.select_victim(deadlocked_pids)
            if victim is not None:
                # Try partial preemption first, then termination if not possible
                preempted = self.preempt_process(victim)
                if preempted:
                    self.metrics.recoveries += 1
                    # Event already logged in preempt_process
                else:
                    self.terminate_process(victim)
                    self.metrics.recoveries += 1
                    self.log_event(EventType.RELEASE, victim, [0]*len(self.state.available), details={"action": "recovery_terminate", "cost_based": True, "iterative": True})
            # Re-check for deadlock after each recovery
            deadlocked_pids = matrix_deadlock_detection(self.state)
            recovery_count += 1

    def preempt_process(self, pid):
        """
        Preempt resources from a process. Supports partial preemption (release only a subset of resources).
        Returns True if preemption was performed, False if not possible.
        """
        # --- Advanced Partial Preemption ---
        # Parameters for extensibility
        partial = True
        min_release = 1
        max_release = None  # None = no cap, else max units to preempt
        resource_types = None  # None = any, else list of resource indices/types to consider
        proc = next((p for p in self.state.processes if p.pid == pid), None)
        if proc is None:
            return False
        from app.models.system_models import ProcessStatus
        if hasattr(proc, 'status') and proc.status in [ProcessStatus.TERMINATED, ProcessStatus.SUSPENDED]:
            return False
        released = [0] * len(proc.allocation)
        total_released = 0
        # Select eligible resource indices
        alloc_indices = [i for i in range(len(proc.allocation)) if proc.allocation[i] > 0]
        if resource_types is not None:
            alloc_indices = [i for i in alloc_indices if i in resource_types]
        # Sort by largest allocation first (default real-world policy)
        alloc_indices = sorted(alloc_indices, key=lambda i: proc.allocation[i], reverse=True)
        # Preempt resources
        for i in alloc_indices:
            if max_release is not None and total_released >= max_release:
                break
            if proc.allocation[i] > 0 and total_released < min_release:
                release_amt = min(proc.allocation[i], min_release - total_released)
                self.state.available[i] += release_amt
                proc.allocation[i] -= release_amt
                proc.need[i] += release_amt
                released[i] = release_amt
                total_released += release_amt
        # If not enough released, fallback to full preemption (real-world: last resort)
        if total_released < min_release:
            for i, val in enumerate(proc.allocation):
                self.state.available[i] += val
                released[i] += val
                proc.need[i] += val
                proc.allocation[i] = 0
            proc.status = ProcessStatus.SUSPENDED
        else:
            # If process still holds resources, keep it RUNNING, else SUSPENDED
            if sum(proc.allocation) == 0:
                proc.status = ProcessStatus.SUSPENDED
            else:
                proc.status = ProcessStatus.RUNNING
        # Remove any outstanding requests if fully suspended
        if proc.status == ProcessStatus.SUSPENDED:
            self.request_queue._queue = [qr for qr in self.request_queue._queue if qr.request.process_id != pid]
        self.state.request_queue = self.request_queue.as_list()
        # Log the partial preemption event with details
        self.log_event(
            EventType.RELEASE,
            pid,
            released,
            details={
                "action": "partial_preempt" if partial else "full_preempt",
                "min_release": min_release,
                "max_release": max_release,
                "resource_types": resource_types,
                "total_released": total_released,
            },
        )
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

    def rollback_to_last_checkpoint(self, max_rollback: int = 5, custom_policy=None, log_failure: bool = True, partial_restore: Optional[List[str]] = None):
        """
        Robust rollback to last checkpoint with loop prevention, extensibility, and error signaling.
        Args:
            max_rollback: Maximum rollback attempts (default 5)
            custom_policy: Optional callable(checkpoints, engine) -> int|None (index to rollback to or None for default)
            log_failure: If True, log a special event on failure
        Returns:
            True if rollback succeeded (system safe), False if not recoverable
        """
        rollback_count = 0
        checkpoints = self.state.checkpoints or []
        quarantined = self._quarantined_checkpoints
        audit = self.rollback_audit_trail
        while checkpoints and rollback_count < max_rollback:
            # Allow custom policy to select which checkpoint to use
            idx = -1
            if callable(custom_policy):
                try:
                    idx = custom_policy(checkpoints, self)
                    if idx is None or not isinstance(idx, int) or not (-len(checkpoints) <= idx < len(checkpoints)):
                        idx = -1
                except Exception as e:
                    idx = -1
            last_cp = checkpoints[idx]
            # --- Checkpoint quarantine: skip if quarantined ---
            if getattr(last_cp, 'checkpoint_id', None) in quarantined:
                checkpoints.pop(idx)
                self.state.checkpoints = checkpoints
                continue
            # --- Checkpoint validation ---
            if callable(self.checkpoint_validator):
                try:
                    if not self.checkpoint_validator(last_cp):
                        quarantined.add(getattr(last_cp, 'checkpoint_id', None))
                        checkpoints.pop(idx)
                        self.state.checkpoints = checkpoints
                        continue
                except Exception as e:
                    quarantined.add(getattr(last_cp, 'checkpoint_id', None))
                    checkpoints.pop(idx)
                    self.state.checkpoints = checkpoints
                    continue
            # --- Partial restore support ---
            restored = SystemState(**last_cp.system_state)
            if partial_restore:
                for part in partial_restore:
                    if part == 'processes':
                        self.state.processes = restored.processes
                    elif part == 'resources':
                        self.state.total_resources = restored.total_resources
                        self.state.available = restored.available
                    elif part == 'allocation_matrix':
                        self.state.allocation_matrix = restored.allocation_matrix
                    elif part == 'max_matrix':
                        self.state.max_matrix = restored.max_matrix
                    elif part == 'need_matrix':
                        self.state.need_matrix = restored.need_matrix
                    elif part == 'request_queue':
                        self.state.request_queue = restored.request_queue
                    elif part == 'event_log':
                        self.state.event_log = restored.event_log
            else:
                self.state.processes = restored.processes
                self.state.total_resources = restored.total_resources
                self.state.available = restored.available
                self.state.allocation_matrix = restored.allocation_matrix
                self.state.max_matrix = restored.max_matrix
                self.state.need_matrix = restored.need_matrix
                self.state.request_queue = restored.request_queue
                self.state.event_log = restored.event_log
            rollback_count += 1
            self._enforce_checkpoint_retention()
            from app.core.deadlock_detector import matrix_deadlock_detection
            audit.append({
                'checkpoint_id': getattr(last_cp, 'checkpoint_id', None),
                'rollback_count': rollback_count,
                'partial_restore': partial_restore,
                'success': None
            })
            if not matrix_deadlock_detection(self.state):
                # Log success event
                audit[-1]['success'] = True
                self.log_event(EventType.RELEASE, None, [0]*len(self.state.available), details={"action": "rollback_success", "rollback_count": rollback_count, "checkpoint_id": getattr(last_cp, 'checkpoint_id', None)})
                return True
            # Otherwise, pop this checkpoint and try previous, quarantine if failed
            quarantined.add(getattr(last_cp, 'checkpoint_id', None))
            audit[-1]['success'] = False
            checkpoints.pop(idx)
            self.state.checkpoints = checkpoints
        # If failed, log event and escalate if needed
        if log_failure:
            self.log_event(EventType.RELEASE, None, [0]*len(self.state.available), details={"action": "rollback_failed", "rollback_count": rollback_count, "reason": "unrecoverable_or_loop"})
        if callable(self.rollback_escalation_hook):
            try:
                self.rollback_escalation_hook(self, rollback_count, audit)
            except Exception:
                pass
        # --- Fallback to safe state if provided ---
        if callable(self.safe_state_factory):
            try:
                safe_state = self.safe_state_factory()
                if isinstance(safe_state, SystemState):
                    self.state.processes = safe_state.processes
                    self.state.total_resources = safe_state.total_resources
                    self.state.available = safe_state.available
                    self.state.allocation_matrix = safe_state.allocation_matrix
                    self.state.max_matrix = safe_state.max_matrix
                    self.state.need_matrix = safe_state.need_matrix
                    self.state.request_queue = safe_state.request_queue
                    self.state.event_log = safe_state.event_log
                    self.log_event(EventType.RELEASE, None, [0]*len(self.state.available), details={"action": "rollback_fallback_safe_state"})
            except Exception:
                pass
        return False

    def create_checkpoint(self, description: Optional[str] = None):
        import time
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
        # --- Advanced retention: enforce everywhere, allow custom policy ---
        self._enforce_checkpoint_retention()
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
        # --- Event-based checkpointing ---
        if self.checkpoint_on_events and event_type in self.checkpoint_on_events:
            self.create_checkpoint(description=f"Event-based checkpoint: {event_type}")
        # --- External checkpoint trigger (hook) ---
        if self.external_checkpoint_hook and callable(self.external_checkpoint_hook):
            try:
                self.external_checkpoint_hook(self, event)
            except Exception as e:
                # Log or ignore external hook errors
                pass
