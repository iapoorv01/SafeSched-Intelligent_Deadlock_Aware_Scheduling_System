"""
Deadlock detection logic for SafeSched.
"""
from typing import List, Dict, Any
from backend.app.models.system_models import SystemState

def matrix_deadlock_detection(state: SystemState) -> List[str]:
    """
    Detects deadlocked processes using matrix-based approach.
    Returns list of deadlocked process IDs.
    """
    print("[DEBUG] matrix_deadlock_detection: entry")
    n_proc = len(state.processes)
    n_res = len(state.total_resources)
    work = state.available[:]
    finish = [False] * n_proc
    need = state.need_matrix
    alloc = state.allocation_matrix
    # Import ProcessStatus for status check
    from backend.app.models.system_models import ProcessStatus
    for i in range(n_proc):
        # Mark finished if process is terminated, suspended, or holds no resources
        status = getattr(state.processes[i], 'status', None)
        if status in (ProcessStatus.TERMINATED, ProcessStatus.SUSPENDED) or all(alloc[i][j] == 0 for j in range(n_res)):
            finish[i] = True
    iter_count = 0
    while True:
        found = False
        iter_count += 1
        print(f"[DEBUG] matrix_deadlock_detection: loop iter {iter_count}")
        for i in range(n_proc):
            if not finish[i] and all(need[i][j] <= work[j] for j in range(n_res)):
                for j in range(n_res):
                    work[j] += alloc[i][j]
                finish[i] = True
                found = True
                print(f"[DEBUG] matrix_deadlock_detection: progress made, process {i} marked finished")
        if not found:
            print(f"[DEBUG] matrix_deadlock_detection: no progress, breaking loop at iter {iter_count}")
            break
    deadlocked = [state.processes[i].pid for i in range(n_proc) if not finish[i] and getattr(state.processes[i], 'status', None) not in (ProcessStatus.TERMINATED, ProcessStatus.SUSPENDED)]
    print(f"[DEBUG] matrix_deadlock_detection: exit, deadlocked={deadlocked}")
    return deadlocked

def build_wait_for_graph(state: SystemState) -> Dict[str, List[str]]:
    """
    Builds Wait-For Graph (WFG) as adjacency list.
    """
    wfg = {proc.pid: [] for proc in state.processes}
    for req in state.request_queue:
        for i, avail in enumerate(state.available):
            if req.resource_vector[i] > avail:
                wfg[req.process_id].extend([
                    proc.pid for proc in state.processes
                    if proc.allocation[i] > 0 and proc.pid != req.process_id
                ])
    return wfg

def detect_cycles(wfg: Dict[str, List[str]]) -> List[List[str]]:
    """
    Detects cycles in Wait-For Graph.
    Returns list of cycles (deadlocked process groups).
    """
    visited = set()
    stack = []
    cycles = []
    def dfs(node, path):
        if node in path:
            cycle = path[path.index(node):]
            cycles.append(cycle)
            return
        if node in visited:
            return
        visited.add(node)
        for neighbor in wfg.get(node, []):
            dfs(neighbor, path + [neighbor])
    for node in wfg:
        dfs(node, [node])
    # Remove duplicates
    unique_cycles = []
    for c in cycles:
        if c not in unique_cycles:
            unique_cycles.append(c)
    return unique_cycles

def wfg_deadlock_detection(state: SystemState) -> Dict[str, Any]:
    wfg = build_wait_for_graph(state)
    cycles = detect_cycles(wfg)
    deadlocked = list({pid for cycle in cycles for pid in cycle})
    return {"cycles": cycles, "deadlocked_processes": deadlocked}
