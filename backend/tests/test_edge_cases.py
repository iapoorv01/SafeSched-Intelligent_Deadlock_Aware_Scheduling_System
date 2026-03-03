"""
Edge case tests for SafeSched simulation core.
"""
import pytest
from app.models.system_models import ProcessStatus
from app.models.system_models import ProcessStatus
from app.models.system_models import SystemState, ProcessState
from app.models.event_models import Request, Event
from app.core.validator import validate_scenario, ScenarioValidationError
from app.core.banker import banker_safety_check
from app.core.deadlock_detector import matrix_deadlock_detection
from app.core.simulation_engine import SimulationEngine

def test_allocation_exceeds_total_resources():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[5], max_demand=[5], need=[0], status=ProcessStatus.RUNNING)],
        total_resources=[4],
        available=[-1],
        allocation_matrix=[[5]],
        max_matrix=[[5]],
        need_matrix=[[0]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    with pytest.raises(ScenarioValidationError):
        validate_scenario(state)

def test_max_demand_exceeds_total_resources():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1], max_demand=[10], need=[9], status=ProcessStatus.RUNNING)],
        total_resources=[4],
        available=[3],
        allocation_matrix=[[1]],
        max_matrix=[[10]],
        need_matrix=[[9]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    with pytest.raises(ScenarioValidationError):
        validate_scenario(state)

def test_duplicate_process_ids():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1], max_demand=[3], need=[2], status=ProcessStatus.RUNNING),
               ProcessState(pid="P1", allocation=[1], max_demand=[3], need=[2], status=ProcessStatus.RUNNING)],
        total_resources=[4],
        available=[2],
        allocation_matrix=[[1],[1]],
        max_matrix=[[3],[3]],
        need_matrix=[[2],[2]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    with pytest.raises(ScenarioValidationError):
        validate_scenario(state)

def test_request_vector_length_mismatch():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1,0], max_demand=[3,2], need=[2,2], status=ProcessStatus.RUNNING)],
        total_resources=[4,2],
        available=[3,2],
        allocation_matrix=[[1,0]],
        max_matrix=[[3,2]],
        need_matrix=[[2,2]],
        request_queue=[Request(process_id="P1", resource_vector=[1])],
        event_log=[],
        seed=42
    )
    with pytest.raises(ScenarioValidationError):
        validate_scenario(state)

def test_empty_system():
    state = SystemState(
        processes=[],
        total_resources=[],
        available=[],
        allocation_matrix=[],
        max_matrix=[],
        need_matrix=[],
        request_queue=[],
        event_log=[],
        seed=42
    )
    # Should not raise, but should be a valid empty system
    validate_scenario(state)

def test_all_processes_finished():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[0], need=[0], status=ProcessStatus.TERMINATED)],
        total_resources=[0],
        available=[0],
        allocation_matrix=[[0]],
        max_matrix=[[0]],
        need_matrix=[[0]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    validate_scenario(state)
    result = banker_safety_check(state)
    assert result["safe"] is True
    assert result["safe_sequence"] == ["P1"]

def test_all_resources_allocated_but_no_deadlock():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[2], max_demand=[2], need=[0], status=ProcessStatus.RUNNING),
               ProcessState(pid="P2", allocation=[2], max_demand=[2], need=[0], status=ProcessStatus.RUNNING)],
        total_resources=[4],
        available=[0],
        allocation_matrix=[[2],[2]],
        max_matrix=[[2],[2]],
        need_matrix=[[0],[0]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    deadlocked = matrix_deadlock_detection(state)
    assert deadlocked == []

def test_multiple_simultaneous_requests():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[2], need=[2], status=ProcessStatus.RUNNING),
               ProcessState(pid="P2", allocation=[0], max_demand=[2], need=[2], status=ProcessStatus.RUNNING)],
        total_resources=[2],
        available=[2],
        allocation_matrix=[[0],[0]],
        max_matrix=[[2],[2]],
        need_matrix=[[2],[2]],
        request_queue=[Request(process_id="P1", resource_vector=[1]), Request(process_id="P2", resource_vector=[1])],
        event_log=[],
        seed=42
    )
    engine = SimulationEngine(state)
    engine.step()
    # Only one request should be granted in a deterministic step
    granted = sum(p.allocation[0] for p in state.processes)
    assert granted == 1
