"""
Tests for deadlock detection.
"""
from app.models.system_models import SystemState, ProcessState
from app.core.deadlock_detector import matrix_deadlock_detection, wfg_deadlock_detection

def test_matrix_deadlock_detection():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1], max_demand=[3], need=[2], status="RUNNING"),
                   ProcessState(pid="P2", allocation=[2], max_demand=[2], need=[0], status="RUNNING")],
        total_resources=[4],
        available=[1],
        allocation_matrix=[[1],[2]],
        max_matrix=[[3],[2]],
        need_matrix=[[2],[0]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    deadlocked = matrix_deadlock_detection(state)
    assert "P1" in deadlocked or "P2" in deadlocked

def test_wfg_deadlock_detection():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1], max_demand=[3], need=[2], status="RUNNING"),
                   ProcessState(pid="P2", allocation=[2], max_demand=[2], need=[0], status="RUNNING")],
        total_resources=[4],
        available=[1],
        allocation_matrix=[[1],[2]],
        max_matrix=[[3],[2]],
        need_matrix=[[2],[0]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    result = wfg_deadlock_detection(state)
    assert isinstance(result["cycles"], list)
    assert isinstance(result["deadlocked_processes"], list)
