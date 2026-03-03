"""
Banker's Algorithm implementation for SafeSched.
"""
from typing import List, Dict, Any
from app.models.system_models import SystemState, ProcessState

def compute_need(state: SystemState) -> List[List[int]]:
    """
    Computes the need matrix for all processes.
    """
    need_matrix = []
    for proc in state.processes:
        need = [m - a for m, a in zip(proc.max_demand, proc.allocation)]
        need_matrix.append(need)
    return need_matrix

def banker_safety_check(state: SystemState) -> Dict[str, Any]:
    """
    Performs Banker's safety check and returns safe status, sequence, and explanation steps.
    """
    n_proc = len(state.processes)
    n_res = len(state.total_resources)
    work = state.available[:]
    finish = [False] * n_proc
    need = compute_need(state)
    alloc = state.allocation_matrix
    safe_sequence = []
    explanation_steps = []
    while True:
        found = False
        for i in range(n_proc):
            if not finish[i] and all(need[i][j] <= work[j] for j in range(n_res)):
                explanation_steps.append({
                    "process": state.processes[i].pid,
                    "work_before": work[:],
                    "need": need[i][:],
                    "allocation": alloc[i][:]
                })
                for j in range(n_res):
                    work[j] += alloc[i][j]
                finish[i] = True
                safe_sequence.append(state.processes[i].pid)
                found = True
            if not found:
                continue
    safe = all(finish)
    return {
        "safe": safe,
        "safe_sequence": safe_sequence if safe else [],
        "explanation_steps": explanation_steps
    }

def get_safe_sequence(state: SystemState) -> List[str]:
    result = banker_safety_check(state)
    return result["safe_sequence"] if result["safe"] else []
