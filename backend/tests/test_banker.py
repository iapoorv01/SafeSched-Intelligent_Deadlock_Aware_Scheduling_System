"""
Tests for Banker's Algorithm.
"""
from app.models.system_models import SystemState, ProcessState, ProcessStatus
from app.core.banker import banker_safety_check

def test_banker_safe_case():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1], max_demand=[3], need=[2], status=ProcessStatus.RUNNING),
                   ProcessState(pid="P2", allocation=[1], max_demand=[2], need=[1], status=ProcessStatus.RUNNING)],
        total_resources=[4],
        available=[2],
        allocation_matrix=[[1],[1]],
        max_matrix=[[3],[2]],
        need_matrix=[[2],[1]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    result = banker_safety_check(state)
    assert result["safe"] is True
    assert set(result["safe_sequence"]) == {"P1", "P2"}

def test_banker_unsafe_case():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[2], max_demand=[3], need=[1], status=ProcessStatus.RUNNING),
                   ProcessState(pid="P2", allocation=[2], max_demand=[2], need=[0], status=ProcessStatus.RUNNING)],
        total_resources=[4],
        available=[0],
        allocation_matrix=[[2],[2]],
        max_matrix=[[3],[2]],
        need_matrix=[[1],[0]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    result = banker_safety_check(state)
    assert result["safe"] is False
    assert result["safe_sequence"] == []
