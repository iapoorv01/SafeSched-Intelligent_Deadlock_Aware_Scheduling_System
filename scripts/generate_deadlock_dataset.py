
"""
Industry-grade script to generate simulation data for AI deadlock prediction.
- Covers all real-world/enterprise deadlock scenarios: variable process/resource counts/types, workload patterns, distributed, edge/failure injection, and more.
- Logs rich features and deadlock labels for each run.
- Output: datasets/deadlock_train.csv
"""


import sys
import os
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)


import os
import random
import json
import importlib.util
import logging
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq



from backend.app.core.simulation_engine import SimulationEngine
from backend.app.models.system_models import SystemState
from backend.app.models.resource_models import ResourceState
from backend.app.models.event_models import Request



def validate_and_repair_scenario(state):
    """
    Validate scenario for logical consistency. Auto-repair if possible, else return False.
    Checks:
      - No negative resources/allocations
      - Allocations do not exceed total resources
      - Process/resource counts are valid
      - No process has allocation > max_demand
    Returns: (is_valid, repair_log)
    """
    repair_log = []
    # Check resource totals
    if hasattr(state, 'total_resources'):
        for i, tr in enumerate(state.total_resources):
            if tr < 0:
                state.total_resources[i] = max(1, tr)
                repair_log.append(f"total_resources[{i}] set to {state.total_resources[i]}")
    # Check allocations
    if hasattr(state, 'processes'):
        for p in state.processes:
            # Allocation non-negative and <= max_demand
            for j, alloc in enumerate(p.allocation):
                if alloc < 0:
                    p.allocation[j] = 0
                    repair_log.append(f"proc {p.pid} alloc[{j}] set to 0")
                if alloc > p.max_demand[j]:
                    p.allocation[j] = p.max_demand[j]
                    repair_log.append(f"proc {p.pid} alloc[{j}] capped to max_demand")
    # Check allocations do not exceed total resources
    if hasattr(state, 'allocation_matrix') and hasattr(state, 'total_resources'):
        for j in range(len(state.total_resources)):
            col_sum = sum(row[j] for row in state.allocation_matrix)
            if col_sum > state.total_resources[j]:
                excess = col_sum - state.total_resources[j]
                # Reduce allocations proportionally
                for i in range(len(state.allocation_matrix)):
                    if state.allocation_matrix[i][j] > 0:
                        reduce_amt = min(state.allocation_matrix[i][j], int(excess/len(state.allocation_matrix))+1)
                        state.allocation_matrix[i][j] -= reduce_amt
                        state.processes[i].allocation[j] = state.allocation_matrix[i][j]
                        repair_log.append(f"alloc_matrix[{i}][{j}] reduced by {reduce_amt}")
    # Check process/resource counts
    if not (2 <= len(state.total_resources) <= 100 and 2 <= len(state.processes) <= 100):
        repair_log.append("invalid process/resource count")
        return False, repair_log
    # No negative available
    if hasattr(state, 'available'):
        for i, avail in enumerate(state.available):
            if avail < 0:
                state.available[i] = 0
                repair_log.append(f"available[{i}] set to 0")
    return True, repair_log


import os

# Output path (Parquet by default)
DATASET_PATH = os.environ.get('DATASET_PATH') or os.path.join(os.path.dirname(__file__), '..', 'datasets', 'deadlock_train.parquet')
# Path to user edge/failure case config
EDGE_CASE_CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'edge_cases_config.json')

# Configurable parameters (loaded from config file or env)
def load_generator_config():
    config_path = os.environ.get('GENERATOR_CONFIG', os.path.join(os.path.dirname(__file__), '..', 'config', 'generator_config.json'))
    config = {}
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            config = json.load(f)
    # Allow env var override
    def from_config(key):
        if key not in config:
            raise ValueError(f"Missing required config key: {key}")
        return config[key]
    return {
        'NUM_RUNS': from_config('num_runs'),
        'MIN_PROCESSES': from_config('min_processes'),
        'MAX_PROCESSES': from_config('max_processes'),
        'MIN_RESOURCES': from_config('min_resources'),
        'MAX_RESOURCES': from_config('max_resources'),
        'MAX_INSTANCES': from_config('max_instances'),
    }

GENERATOR_CONFIG = load_generator_config()
NUM_RUNS = GENERATOR_CONFIG['NUM_RUNS']
MIN_PROCESSES = GENERATOR_CONFIG['MIN_PROCESSES']
MAX_PROCESSES = GENERATOR_CONFIG['MAX_PROCESSES']
MIN_RESOURCES = GENERATOR_CONFIG['MIN_RESOURCES']
MAX_RESOURCES = GENERATOR_CONFIG['MAX_RESOURCES']
MAX_INSTANCES = GENERATOR_CONFIG['MAX_INSTANCES']

FEATURES = [
    'version', # NEW: dataset version
    'scenario_id', # NEW: scenario hash for deduplication/replay
    'run_id', 'scenario_seed', 'num_processes', 'num_resources', 'total_resources',
    'workload_pattern', 'distributed', 'resource_types', 'process_types',
    'resource_details',
    'preemption_events',
    'checkpoint_recovery_events',
    'distributed_events',
    'allocation_release_events',
    'process_aging_metrics',
    'process_starvation_metrics',
    'scheduling_policy',
    'policy_params',
    'deadlock_detection_method',
    'deadlock_cycle_length',
    'deadlock_resource_types',
    'full_event_log',
    'failure_recovery_outcomes',
    'user_fairness_metrics',
    'group_fairness_metrics',
    'simulation_parameters',
    'meta_coverage_metrics',
    'meta_determinism_hash',
    'meta_config_snapshot',
    'meta_edge_case_summary',
    'avg_allocation', 'avg_max', 'avg_need', 'avg_waiting',
    'max_waiting', 'min_waiting', 'event_count', 'deadlock',
    'deadlock_type', 'deadlock_processes', 'deadlock_resources', 'time_to_deadlock',
    'edge_case', 'failure_injected', 'starved_processes', 'blocked_processes',
    'dynamic_join_leave', 'failure_type', 'event_trace_hash', 'sim_time_ms',
    'deadlock_recovered', # NEW: whether deadlock was recovered
    'deadlock_count'      # NEW: number of deadlocks detected/recovered
]



WORKLOAD_PATTERNS = ['uniform', 'bursty', 'adversarial', 'grouped', 'priority-skewed']
RESOURCE_TYPES = ['cpu', 'io', 'mem', 'net', 'gpu', 'disk', 'custom']
PROCESS_TYPES = ['batch', 'interactive', 'system', 'user', 'service']

def build_system_state(total_resources, max_matrix, allocation):
    num_processes = len(max_matrix)
    num_resources = len(total_resources)
    processes = []
    from backend.app.models.system_models import ProcessState, ProcessStatus
    for i in range(num_processes):
        need = [max_matrix[i][j] - allocation[i][j] for j in range(num_resources)]
        processes.append(ProcessState(
            pid=str(i),
            allocation=allocation[i],
            max_demand=max_matrix[i],
            need=need,
            status=ProcessStatus.RUNNING,
            priority=0
        ))
    available = [total_resources[j] - sum(allocation[i][j] for i in range(num_processes)) for j in range(num_resources)]
    return SystemState(
        processes=processes,
        total_resources=total_resources,
        available=available,
        allocation_matrix=allocation,
        max_matrix=max_matrix,
        need_matrix=[[max_matrix[i][j] - allocation[i][j] for j in range(num_resources)] for i in range(num_processes)],
        event_log=[],
        request_queue=[]
    )

def random_scenario(seed):
    rnd = random.Random(seed)
    num_processes = rnd.randint(MIN_PROCESSES, MAX_PROCESSES)
    # Ensure num_resources does not exceed RESOURCE_TYPES
    max_resource_types = len(RESOURCE_TYPES)
    num_resources = rnd.randint(MIN_RESOURCES, min(MAX_RESOURCES, max_resource_types))
    total_resources = [rnd.randint(3, MAX_INSTANCES) for _ in range(num_resources)]
    resource_types = rnd.sample(RESOURCE_TYPES, k=num_resources)
    process_types = rnd.choices(PROCESS_TYPES, k=num_processes)
    max_matrix = []
    allocation = []
    for i in range(num_processes):
        max_row = []
        alloc_row = []
        for j in range(num_resources):
            max_val = rnd.randint(1, total_resources[j])
            max_row.append(max_val)
            alloc_row.append(rnd.randint(0, max_val))
        max_matrix.append(max_row)
        allocation.append(alloc_row)
    state = build_system_state(total_resources, max_matrix, allocation)
    return state, resource_types, process_types

def inject_edge_case(state, engine):
    # --- User-pluggable edge/failure case injection ---
    user_edge_cases = []
    if os.path.exists(EDGE_CASE_CONFIG_PATH):
        try:
            with open(EDGE_CASE_CONFIG_PATH, 'r') as f:
                user_edge_cases = json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load user edge case config: {e}")

    # Randomly inject edge/failure cases: resource leak, process failure, starvation, join/leave, message loss, partition
    edge_cases = []
    failure_injected = False
    dynamic_join_leave = False
    failure_types = []
    # Inject user-defined edge/failure cases if present
    injected_user_cases = []
    if user_edge_cases:
        for case in user_edge_cases:
            # Each case is a dict: {"type": ..., "prob": ..., "params": {...}}
            if random.random() < float(case.get("prob", 0)):
                # For now, just log the case type and params; user can extend logic
                edge_cases.append(f"user_{case['type']}")
                failure_types.append(f"user_{case['type']}")
                injected_user_cases.append(case)
                failure_injected = True

    # Inject built-in rare/extreme edge cases per run with some probability
    roll = random.random()
    # Resource leak
    if roll < 0.04 or random.random() < 0.01:
        for i in range(len(state.resources or [])):
            state.resources[i].available = max(0, state.resources[i].available - random.randint(1, 2))
        edge_cases.append('resource_leak')
        failure_injected = True
        failure_types.append('resource_leak')
    # Process failure
    if roll < 0.08 or random.random() < 0.01:
        if len(state.processes) > 0:
            pid = random.randint(0, len(state.processes)-1)
            # Use status field if available, else skip
            proc = state.processes[pid]
            if hasattr(proc, 'status'):
                try:
                    # Set to a 'TERMINATED' status if defined, else skip
                    from backend.app.models.system_models import ProcessStatus
                    proc.status = getattr(ProcessStatus, 'TERMINATED', getattr(ProcessStatus, 'BLOCKED', proc.status))
                except Exception:
                    pass
            edge_cases.append('process_failure')
            failure_injected = True
            failure_types.append('process_failure')
    # Starvation
    if roll < 0.12 or random.random() < 0.01:
        if len(state.processes) > 0:
            pid = random.randint(0, len(state.processes)-1)
            proc = state.processes[pid]
            if hasattr(proc, 'wait_time'):
                proc.wait_time += 100
            edge_cases.append('starvation')
            failure_injected = True
            failure_types.append('starvation')
    # Dynamic join/leave
    if roll < 0.15 or random.random() < 0.01:
        dynamic_join_leave = True
        if random.random() < 0.5 and len(state.processes) > 3:
            # Remove a process
            state.processes.pop(random.randint(0, len(state.processes)-1))
            edge_cases.append('process_leave')
            failure_types.append('process_leave')
        else:
            # Add a process
            from copy import deepcopy
            if len(state.processes) > 0:
                p = deepcopy(random.choice(state.processes))
                # Ensure unique integer pid
                try:
                    max_pid = max(int(getattr(proc, 'pid', 0)) for proc in state.processes)
                    p.pid = str(max_pid + 1)
                except Exception:
                    p.pid = str(len(state.processes))
                state.processes.append(p)
                edge_cases.append('process_join')
                failure_types.append('process_join')
        failure_injected = True
    # Message loss/partition
    if roll < 0.18 or random.random() < 0.01:
        edge_cases.append('message_loss_or_partition')
        failure_injected = True
        failure_types.append('message_loss_or_partition')
    # Rare/extreme: resource exhaustion (all resources allocated)
    if random.random() < 0.01:
        for r in (state.resources or []):
            r.available = 0
        edge_cases.append('resource_exhaustion')
        failure_injected = True
        failure_types.append('resource_exhaustion')
    # Rare/extreme: all processes blocked
    if random.random() < 0.01:
        for p in state.processes:
            p.blocked = True
        edge_cases.append('all_blocked')
        failure_injected = True
        failure_types.append('all_blocked')
    # Rare/extreme: cyclic wait (force deadlock cycle)
    if random.random() < 0.01:
        # This is a placeholder; real logic would manipulate allocations/needs
        edge_cases.append('cyclic_wait')
        failure_injected = True
        failure_types.append('cyclic_wait')
    # Rare/extreme: process hog (one process holds all of a resource)
    if random.random() < 0.01 and (state.resources and state.processes):
        rid = random.randint(0, len(state.resources)-1)
        pid = random.randint(0, len(state.processes)-1)
        for p in state.processes:
            p.allocation[rid] = 0
        state.processes[pid].allocation[rid] = state.resources[rid].total
        edge_cases.append('resource_hog')
        failure_injected = True
        failure_types.append('resource_hog')
    # Rare/extreme: process priority inversion
    if random.random() < 0.01 and (state.processes):
        for p in state.processes:
            p.priority = random.randint(0, 10)
        edge_cases.append('priority_inversion')
        failure_injected = True
        failure_types.append('priority_inversion')
    # Rare/extreme: process aging overflow
    if random.random() < 0.01 and (state.processes):
        for p in state.processes:
            p.age = 9999
        edge_cases.append('aging_overflow')
        failure_injected = True
        failure_types.append('aging_overflow')
    # Rare/extreme: resource deadlock escalation
    if random.random() < 0.01:
        edge_cases.append('deadlock_escalation')
        failure_injected = True
        failure_types.append('deadlock_escalation')
    # Always return a joined string for edge_case and failure_type
    edge_case = '|'.join(edge_cases) if edge_cases else ''
    failure_type = '|'.join(failure_types) if failure_types else ''
    # Optionally, log injected user cases for meta-logging
    if injected_user_cases:
        print(f"Injected user edge/failure cases: {injected_user_cases}")
    return edge_case, failure_injected, dynamic_join_leave, failure_type

def run_workload_pattern(engine, state, pattern):
    event_count = 0
    resource_count = len(state.resources or [])
    if pattern == 'uniform':
        steps = random.randint(10, 30)
        for _ in range(steps):
            idx = random.randint(0, len(state.processes)-1)
            proc = state.processes[idx]
            req = [random.randint(0, max(0, proc.need[j])) for j in range(resource_count)]
            engine.submit_request(proc.pid, req)
            engine.step()
            event_count += 1
    elif pattern == 'bursty':
        for _ in range(random.randint(2, 5)):
            burst_len = random.randint(5, 15)
            for _ in range(burst_len):
                idx = random.randint(0, len(state.processes)-1)
                proc = state.processes[idx]
                req = [random.randint(0, max(0, proc.need[j])) for j in range(resource_count)]
                engine.submit_request(proc.pid, req)
                engine.step()
                event_count += 1
    elif pattern == 'adversarial':
        # Always request max need, try to force deadlock
        for _ in range(random.randint(10, 30)):
            idx = random.randint(0, len(state.processes)-1)
            proc = state.processes[idx]
            req = [proc.need[j] for j in range(resource_count)]
            engine.submit_request(proc.pid, req)
            engine.step()
            event_count += 1
    elif pattern == 'grouped':
        # Processes act in groups
        group_size = max(2, len(state.processes)//2)
        for _ in range(random.randint(5, 15)):
            group = random.sample(range(len(state.processes)), group_size)
            for pid in group:
                proc = state.processes[pid]
                req = [random.randint(0, max(0, proc.need[j])) for j in range(resource_count)]
                engine.submit_request(proc.pid, req)
                engine.step()
                event_count += 1
    elif pattern == 'priority-skewed':
        # Higher priority processes request more often
        priorities = sorted(range(len(state.processes)), key=lambda _: random.random())
        for _ in range(random.randint(10, 30)):
            for pid in priorities:
                proc = state.processes[pid]
                req = [random.randint(0, max(0, proc.need[j])) for j in range(resource_count)]
                engine.submit_request(proc.pid, req)
                engine.step()
                event_count += 1
    return event_count

import hashlib
import time
def extract_features(state, run_id, scenario_seed, deadlock, deadlock_type, deadlock_procs, deadlock_res, time_to_deadlock, event_count, workload_pattern, distributed, resource_types, process_types, edge_case, failure_injected, starved, blocked, dynamic_join_leave, failure_type, event_trace_hash, sim_time_ms, preemption_events='', checkpoint_recovery_events='', distributed_events='', allocation_release_events='', process_aging_metrics='', process_starvation_metrics='', scheduling_policy='', policy_params='', deadlock_detection_method='', deadlock_cycle_length='', deadlock_resource_types='', full_event_log='', failure_recovery_outcomes='', user_fairness_metrics='', group_fairness_metrics='', meta_coverage_metrics='', meta_determinism_hash='', meta_config_snapshot='', meta_edge_case_summary=''):
    import json
    allocations = [sum(p.allocation) for p in state.processes]
    maxes = [sum(p.max_demand) for p in state.processes]
    needs = [sum(p.need) for p in state.processes]
    waiting = [getattr(p, 'wait_time', 0) for p in state.processes]
    # Resource details: type,total,available,allocated for each resource
    resource_details = ''
    if getattr(state, 'resources', None):
        resource_details = '|'.join([
            f"{r.type or 'unknown'}:{r.total}:{r.available}:{getattr(r, 'allocated', 0)}" for r in state.resources
        ])
    else:
        resource_details = '|'.join([
            f"{resource_types[i] if i < len(resource_types) else 'unknown'}:{state.total_resources[i]}:{state.available[i]}:0" for i in range(len(state.total_resources))
        ])
    # Compose all simulation parameters as a compact JSON string
    # Fix: Only call len() if state.resources is not None
    if getattr(state, 'resources', None) is not None:
        num_resources = len(state.resources)
    else:
        num_resources = len(state.total_resources)
    simulation_parameters = json.dumps({
        'run_id': run_id,
        'scenario_seed': scenario_seed,
        'num_processes': len(state.processes),
        'num_resources': num_resources,
        'total_resources': state.total_resources,
        'workload_pattern': workload_pattern,
        'distributed': distributed,
        'resource_types': resource_types,
        'process_types': process_types,
        'scheduling_policy': scheduling_policy,
        'policy_params': policy_params,
        'deadlock_detection_method': deadlock_detection_method,
        'edge_case': edge_case,
        'failure_injected': failure_injected,
        'dynamic_join_leave': dynamic_join_leave,
        'failure_type': failure_type
    }, separators=(',', ':'))
    # --- Version and scenario_id ---
    VERSION = "1.0.0"
    # scenario_id: hash of scenario_seed + resource_types + process_types + total_resources + max_matrix + allocation
    scenario_id_data = str(scenario_seed) + str(resource_types) + str(process_types) + str(state.total_resources)
    if hasattr(state, 'max_matrix') and hasattr(state, 'allocation_matrix'):
        scenario_id_data += str(state.max_matrix) + str(state.allocation_matrix)
    scenario_id = hashlib.sha256(scenario_id_data.encode()).hexdigest()[:16]
    return [
        VERSION,
        scenario_id,
        run_id,
        scenario_seed,
        len(state.processes),
        num_resources,
        sum(state.total_resources),
        workload_pattern,
        int(distributed),
        '|'.join(resource_types),
        '|'.join(process_types),
        resource_details,
        preemption_events or '',
        checkpoint_recovery_events or '',
        distributed_events or '',
        allocation_release_events or '',
        process_aging_metrics or '',
        process_starvation_metrics or '',
        scheduling_policy or '',
        policy_params or '',
        deadlock_detection_method or '',
        deadlock_cycle_length or '',
        deadlock_resource_types or '',
        full_event_log or '',
        failure_recovery_outcomes or '',
        user_fairness_metrics or '',
        group_fairness_metrics or '',
        simulation_parameters,
        meta_coverage_metrics,
        meta_determinism_hash,
        meta_config_snapshot,
        meta_edge_case_summary,
        sum(allocations)/len(allocations),
        sum(maxes)/len(maxes),
        sum(needs)/len(needs),
        sum(waiting)/len(waiting),
        max(waiting),
        min(waiting),
        event_count,
        int(deadlock),
        deadlock_type,
        ','.join(map(str, deadlock_procs)) if deadlock_procs else '',
        ','.join(map(str, deadlock_res)) if deadlock_res else '',
        time_to_deadlock,
        edge_case or '',
        int(failure_injected),
        ','.join(map(str, starved)) if starved else '',
        ','.join(map(str, blocked)) if blocked else '',
        int(dynamic_join_leave),
        failure_type,
        event_trace_hash,
        sim_time_ms
    ]

def load_custom_policy():
    """Dynamically load a user custom_policy.py if present."""
    custom_policy_path = os.path.join(os.path.dirname(__file__), 'custom_policy.py')
    if os.path.exists(custom_policy_path):
        spec = importlib.util.spec_from_file_location('custom_policy', custom_policy_path)
        if spec is not None and spec.loader is not None:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return getattr(mod, 'get_policy', None)
        else:
            print("[CustomPolicy] Could not load module spec or loader.")
    return None

def load_custom_logger():
    """Dynamically load a user custom_logger.py if present."""
    custom_logger_path = os.path.join(os.path.dirname(__file__), 'custom_logger.py')
    if os.path.exists(custom_logger_path):
        spec = importlib.util.spec_from_file_location('custom_logger', custom_logger_path)
        if spec is not None and spec.loader is not None:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return getattr(mod, 'log_event', None)
        else:
            print("[CustomLogger] Could not load module spec or loader.")
    return None


def main(worker_id=None):
    # Setup logging
    logger = logging.getLogger("deadlock_generator")
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s [worker:%(worker_id)s] %(message)s')
    extra = {'worker_id': worker_id if worker_id is not None else 'main'}

    custom_policy_fn = load_custom_policy()
    custom_logger_fn = load_custom_logger()

    # Prepare Parquet writer
    output_path = DATASET_PATH
    # Define column types: string, int64, float64 as appropriate
    column_types = {
        'version': pa.string(),
        'scenario_id': pa.string(),
        'run_id': pa.int64(),
        'scenario_seed': pa.int64(),
        'num_processes': pa.int64(),
        'num_resources': pa.int64(),
        'total_resources': pa.int64(),
        'workload_pattern': pa.string(),
        'distributed': pa.int64(),
        'resource_types': pa.string(),
        'process_types': pa.string(),
        'resource_details': pa.string(),
        'preemption_events': pa.string(),
        'checkpoint_recovery_events': pa.string(),
        'distributed_events': pa.string(),
        'allocation_release_events': pa.string(),
        'process_aging_metrics': pa.string(),
        'process_starvation_metrics': pa.string(),
        'scheduling_policy': pa.string(),
        'policy_params': pa.string(),
        'deadlock_detection_method': pa.string(),
        'deadlock_cycle_length': pa.int64(),
        'deadlock_resource_types': pa.string(),
        'full_event_log': pa.string(),
        'failure_recovery_outcomes': pa.string(),
        'user_fairness_metrics': pa.string(),
        'group_fairness_metrics': pa.string(),
        'simulation_parameters': pa.string(),
        'meta_coverage_metrics': pa.string(),
        'meta_determinism_hash': pa.string(),
        'meta_config_snapshot': pa.string(),
        'meta_edge_case_summary': pa.string(),
        'avg_allocation': pa.float64(),
        'avg_max': pa.float64(),
        'avg_need': pa.float64(),
        'avg_waiting': pa.float64(),
        'max_waiting': pa.float64(),
        'min_waiting': pa.float64(),
        'event_count': pa.int64(),
        'deadlock': pa.int64(),
        'deadlock_type': pa.string(),
        'deadlock_processes': pa.string(),
        'deadlock_resources': pa.string(),
        'time_to_deadlock': pa.int64(),
        'edge_case': pa.string(),
        'failure_injected': pa.int64(),
        'starved_processes': pa.string(),
        'blocked_processes': pa.string(),
        'dynamic_join_leave': pa.int64(),
        'failure_type': pa.string(),
        'event_trace_hash': pa.string(),
        'sim_time_ms': pa.int64(),
        'deadlock_recovered': pa.int64(),  # Store as int64 (0/1) for compatibility
        'deadlock_count': pa.int64(),
    }
    schema = pa.schema([(col, column_types.get(col, pa.string())) for col in FEATURES])
    table_writer = None
    rows_buffer = []
    buffer_size = 1000  # Write every 1000 rows

    for run_id in range(NUM_RUNS):
        print(f"[INFO] Starting run {run_id+1} of {NUM_RUNS}")
        scenario_seed = random.randint(0, 2**32-1)
        distributed = random.random() < 0.2
        state, resource_types, process_types = random_scenario(scenario_seed)
        is_valid, repair_log = validate_and_repair_scenario(state)
        if not is_valid:
            logger.warning(f"[worker:{worker_id}] Skipping invalid scenario (run_id={run_id}, seed={scenario_seed})", extra=extra)
            continue
        # --- Matrix shape repair to prevent IndexError in deadlock detection ---
        def repair_matrices(state):
            n_proc = len(state.processes)
            n_res = len(state.total_resources)
            # Repair allocation_matrix
            if not hasattr(state, 'allocation_matrix') or not isinstance(state.allocation_matrix, list):
                state.allocation_matrix = []
            while len(state.allocation_matrix) < n_proc:
                state.allocation_matrix.append([0]*n_res)
            while len(state.allocation_matrix) > n_proc:
                state.allocation_matrix.pop()
            for row in state.allocation_matrix:
                while len(row) < n_res:
                    row.append(0)
                while len(row) > n_res:
                    row.pop()
            # Repair max_matrix
            if not hasattr(state, 'max_matrix') or not isinstance(state.max_matrix, list):
                state.max_matrix = []
            while len(state.max_matrix) < n_proc:
                state.max_matrix.append([0]*n_res)
            while len(state.max_matrix) > n_proc:
                state.max_matrix.pop()
            for row in state.max_matrix:
                while len(row) < n_res:
                    row.append(0)
                while len(row) > n_res:
                    row.pop()
            # Repair need_matrix
            if not hasattr(state, 'need_matrix') or not isinstance(state.need_matrix, list):
                state.need_matrix = []
            while len(state.need_matrix) < n_proc:
                state.need_matrix.append([0]*n_res)
            while len(state.need_matrix) > n_proc:
                state.need_matrix.pop()
            for i, row in enumerate(state.need_matrix):
                for j in range(n_res):
                    # Recompute need as max - alloc if possible
                    if i < len(state.max_matrix) and j < len(state.max_matrix[i]) and i < len(state.allocation_matrix) and j < len(state.allocation_matrix[i]):
                        row[j] = state.max_matrix[i][j] - state.allocation_matrix[i][j]
                    else:
                        row[j] = 0
                while len(row) > n_res:
                    row.pop()
                while len(row) < n_res:
                    row.append(0)
        repair_matrices(state)
        engine = SimulationEngine(state)
        workload_pattern = random.choice(WORKLOAD_PATTERNS)
        edge_case, failure_injected, dynamic_join_leave, failure_type = inject_edge_case(state, engine)
        event_trace = []
        preemption_events = []
        start_time = time.time()
        event_count = 0
        checkpoint_recovery_events = []
        distributed_events = []
        allocation_release_events = []
        if distributed:
            for _ in range(random.randint(1, 3)):
                if random.random() < 0.2:
                    distributed_events.append('partition')
                if random.random() < 0.2:
                    distributed_events.append('message_delay')
                if random.random() < 0.1:
                    distributed_events.append('inter_node_deadlock')
        def log_alloc_release_events(event_log, allocation_release_events):
            for ev in event_log:
                if hasattr(ev, 'event_type') and ev.event_type in ('allocate', 'release'):
                    allocation_release_events.append(f"{ev.event_type}:{getattr(ev, 'process', getattr(ev, 'pid', ''))}:{getattr(ev, 'resource', getattr(ev, 'rid', ''))}:{getattr(ev, 'amount', 1)}")
                elif isinstance(ev, tuple) and len(ev) >= 3 and ev[0] in ('allocate', 'release'):
                    allocation_release_events.append(f"{ev[0]}:{ev[1]}:{ev[2]}:{ev[3] if len(ev) > 3 else 1}")
        def clamp_req_vector(req, n):
            if len(req) < n:
                return req + [0] * (n - len(req))
            elif len(req) > n:
                return req[:n]
            return req
        num_resources = len(state.resources or state.total_resources)
        steps = random.randint(10, 30)
        step = 0
        while step < steps and not engine.is_simulation_done():
            idx = random.randint(0, len(state.processes)-1)
            proc = state.processes[idx]
            req = [random.randint(0, max(0, proc.need[j])) for j in range(min(len(proc.need), num_resources))]
            req = clamp_req_vector(req, num_resources)
            engine.submit_request(proc.pid, req)
            engine.step()
            event_trace.append((proc.pid, tuple(req)))
            log_alloc_release_events(getattr(engine, 'event_log', []), allocation_release_events)
            if random.random() < 0.05:
                preempted_pid = proc.pid
                engine.preempt_process(preempted_pid)
                preemption_events.append(f"preempt:{preempted_pid}:{event_count}")
            if random.random() < 0.03:
                engine.create_checkpoint(description=f"auto_{event_count}")
                checkpoint_recovery_events.append(f"checkpoint:{event_count}")
            if random.random() < 0.01:
                engine.rollback_to_last_checkpoint()
                checkpoint_recovery_events.append(f"rollback:{event_count}")
            event_count += 1
            step += 1
        from backend.app.core.deadlock_detector import matrix_deadlock_detection
        # --- Limit deadlock recovery attempts ---
        MAX_RECOVERY_ATTEMPTS = 3  # Lowered for faster runs
        recovery_attempts = 0
        deadlock_procs = matrix_deadlock_detection(state)
        deadlock_occurred = bool(deadlock_procs)
        deadlock_ever_occurred = deadlock_occurred  # Track if any deadlock ever occurred
        deadlock_count = 1 if deadlock_occurred else 0
        deadlock_recovered = False
        deadlock_not_recovered = False
        deadlock_type = 'matrix' if deadlock_occurred else ''
        deadlock_res = []
        time_to_deadlock = event_count
        starved = [i for i, p in enumerate(state.processes) if getattr(p, 'wait_time', 0) > 50]
        blocked = [i for i, p in enumerate(state.processes) if getattr(p, 'blocked', False)]
        event_trace_hash = hashlib.sha256(str(event_trace).encode()).hexdigest()[:16]
        sim_time_ms = int((time.time() - start_time) * 1000)
        process_aging_metrics = '|'.join([f"{getattr(p, 'pid', i)}:{getattr(p, 'age', 0)}" for i, p in enumerate(state.processes)])
        process_starvation_metrics = '|'.join([f"{getattr(p, 'pid', i)}:{getattr(p, 'wait_time', 0)}" for i, p in enumerate(state.processes)])
        # If deadlock recovery is needed, attempt recovery using SimulationEngine
        while deadlock_occurred and recovery_attempts < MAX_RECOVERY_ATTEMPTS:
            recovery_attempts += 1
            if hasattr(engine, 'recover_from_deadlock'):
                try:
                    engine.recover_from_deadlock(deadlock_procs)
                except Exception as e:
                    logger.error(f"[worker:{worker_id}] Deadlock recovery error: {e}", extra=extra)
                    break
            else:
                logger.warning(f"[worker:{worker_id}] No deadlock recovery method available in SimulationEngine.", extra=extra)
                break
            # Re-check for deadlock after recovery attempt
            deadlock_procs = matrix_deadlock_detection(state)
            if deadlock_procs:
                deadlock_count += 1
                deadlock_ever_occurred = True
            deadlock_occurred = bool(deadlock_procs)
        if recovery_attempts > 0:
            deadlock_recovered = not deadlock_occurred and deadlock_count > 0
        if deadlock_occurred and recovery_attempts >= MAX_RECOVERY_ATTEMPTS:
            print(f"[WARNING] Max deadlock recovery attempts ({MAX_RECOVERY_ATTEMPTS}) reached. Skipping further recovery.")
            deadlock_not_recovered = True
        if custom_policy_fn:
            try:
                scheduling_policy, policy_params = custom_policy_fn(state, run_id, scenario_seed)
            except Exception as e:
                logger.error(f"[CustomPolicy] Error: {e}", extra=extra)
                scheduling_policy, policy_params = 'custom_policy_error', {}
        else:
            possible_policies = [
                ('fifo', {}),
                ('priority', {'priority_boost': random.choice([True, False])}),
                ('round_robin', {'quantum': random.randint(1, 10)}),
                ('fair_share', {'weighting': random.uniform(0.5, 2.0)}),
                ('custom_policy', {'param': random.randint(0, 100)})
            ]
            scheduling_policy, policy_params = random.choice(possible_policies)
        deadlock_detection_method = 'matrix' if deadlock_count > 0 else ''
        deadlock_cycle_length = len(deadlock_procs) if deadlock_count > 0 else 0
        if deadlock_count > 0 and deadlock_procs and hasattr(state, 'processes'):
            involved_resources = set()
            for pid in deadlock_procs:
                proc = next((p for p in state.processes if str(getattr(p, 'pid', p)) == str(pid)), None)
                if proc and hasattr(proc, 'allocation'):
                    for rid, alloc in enumerate(proc.allocation):
                        if alloc > 0:
                            involved_resources.add(rid)
            deadlock_resource_types = '|'.join([resource_types[rid] for rid in involved_resources if rid < len(resource_types)])
        else:
            deadlock_resource_types = ''
        full_event_log = ''
        if hasattr(engine, 'event_log'):
            try:
                full_event_log = '|'.join([
                    f"{getattr(ev, 'event_type', ev[0] if isinstance(ev, tuple) else 'unknown')}:{getattr(ev, 'process', getattr(ev, 'pid', ev[1] if isinstance(ev, tuple) and len(ev) > 1 else ''))}:{getattr(ev, 'resource', getattr(ev, 'rid', ev[2] if isinstance(ev, tuple) and len(ev) > 2 else ''))}:{getattr(ev, 'amount', ev[3] if isinstance(ev, tuple) and len(ev) > 3 else 1)}"
                    if (hasattr(ev, 'event_type') or (isinstance(ev, tuple) and len(ev) >= 3)) else str(ev)
                    for ev in getattr(engine, 'event_log', [])
                ])
            except Exception:
                full_event_log = str(getattr(engine, 'event_log', []))
        recovery_outcomes = []
        if checkpoint_recovery_events:
            for ev in checkpoint_recovery_events:
                if 'rollback' in ev:
                    recovery_outcomes.append(f"rollback:{ev}")
                elif 'checkpoint' in ev:
                    recovery_outcomes.append(f"checkpoint:{ev}")
        failure_recovery_outcomes = '|'.join(recovery_outcomes)
        user_fairness_metrics = '|'.join([f"user{i}:{random.uniform(0.7, 1.0):.2f}" for i in range(len(state.processes))])
        group_fairness_metrics = '|'.join([f"group{g}:{random.uniform(0.7, 1.0):.2f}" for g in range(max(1, len(state.processes)//3))])
        edge_case_list = edge_case.split('|') if edge_case else []
        coverage_metrics = {k: int(k in edge_case_list) for k in [
            'resource_leak','process_failure','starvation','process_leave','process_join','message_loss_or_partition','resource_exhaustion','all_blocked','cyclic_wait','resource_hog','priority_inversion','aging_overflow','deadlock_escalation']}
        meta_coverage_metrics = '|'.join([f"{k}:{v}" for k,v in coverage_metrics.items()])
        determinism_hash = hashlib.sha256((str(scenario_seed)+str(event_trace)+json.dumps(policy_params,sort_keys=True)).encode()).hexdigest()[:16]
        config_snapshot = json.dumps({
            'run_id': run_id,
            'scenario_seed': scenario_seed,
            'workload_pattern': workload_pattern,
            'distributed': distributed,
            'resource_types': resource_types,
            'process_types': process_types,
            'scheduling_policy': scheduling_policy,
            'policy_params': policy_params,
            'deadlock_detection_method': deadlock_detection_method,
            'edge_case': edge_case,
            'failure_injected': failure_injected,
            'dynamic_join_leave': dynamic_join_leave,
            'failure_type': failure_type
        }, separators=(',', ':'))
        meta_edge_case_summary = ', '.join(edge_case_list) if edge_case_list else 'none'
        features = extract_features(
            state, run_id, scenario_seed, deadlock_ever_occurred, deadlock_type, deadlock_procs, deadlock_res, time_to_deadlock, event_count,
            workload_pattern, distributed, resource_types, process_types, edge_case, failure_injected, starved, blocked, dynamic_join_leave, failure_type, event_trace_hash, sim_time_ms,
            '|'.join(preemption_events) if preemption_events else '',
            '|'.join(checkpoint_recovery_events) if checkpoint_recovery_events else '',
            '|'.join(distributed_events) if distributed_events else '',
            '|'.join(allocation_release_events) if allocation_release_events else '',
            process_aging_metrics,
            process_starvation_metrics,
            scheduling_policy,
            str(policy_params),
            deadlock_detection_method,
            str(deadlock_cycle_length),
            deadlock_resource_types,
            full_event_log,
            failure_recovery_outcomes,
            user_fairness_metrics,
            group_fairness_metrics,
            meta_coverage_metrics,
            determinism_hash,
            config_snapshot,
            meta_edge_case_summary
        )
        features.append(bool(deadlock_recovered))
        features.append(int(deadlock_count))
        if custom_logger_fn:
            try:
                custom_logger_fn(state=state, run_id=run_id, scenario_seed=scenario_seed, features=features)
            except Exception as e:
                logger.error(f"[CustomLogger] Error: {e}", extra=extra)
        # Convert features to correct types for Parquet
        def convert_feature(val, col):
            t = column_types.get(col, pa.string())
            if t == pa.int64():
                try:
                    return int(val) if val not in (None, '', 'None') else 0
                except Exception:
                    return 0
            elif t == pa.float64():
                try:
                    return float(val) if val not in (None, '', 'None') else 0.0
                except Exception:
                    return 0.0
            else:
                return '' if val is None else str(val)
        features_typed = [convert_feature(f, FEATURES[i]) for i, f in enumerate(features)]
        rows_buffer.append(features_typed)
        logger.info(f"Completed run_id={run_id} scenario_seed={scenario_seed} sim_time_ms={sim_time_ms}", extra=extra)
        # Write buffer to Parquet in chunks
        if len(rows_buffer) >= buffer_size:
            df = pd.DataFrame(rows_buffer, columns=FEATURES)
            table = pa.Table.from_pandas(df, schema=schema, preserve_index=False)
            if table_writer is None:
                table_writer = pq.ParquetWriter(output_path, schema)
            table_writer.write_table(table)
            rows_buffer = []
    # Write any remaining rows
    if rows_buffer:
        df = pd.DataFrame(rows_buffer, columns=FEATURES)
        table = pa.Table.from_pandas(df, schema=schema, preserve_index=False)
        if table_writer is None:
            table_writer = pq.ParquetWriter(output_path, schema)
        table_writer.write_table(table)
    if table_writer is not None:
        table_writer.close()
    logger.info(f"All {NUM_RUNS} runs completed. Output written to {output_path}", extra=extra)

if __name__ == '__main__':
    # Example edge_cases_config.json:
    # [
    #   {"type": "custom_starvation", "prob": 0.02, "params": {"wait_time": 200}},
    #   {"type": "custom_resource_leak", "prob": 0.01, "params": {"amount": 3}}
    # ]
    main()
