"""
Tests for simulation engine step correctness.
"""
from app.models.system_models import SystemState, ProcessState, ProcessStatus
from app.models.event_models import Request
from app.core.simulation_engine import SimulationEngine

def test_simulation_step_grant():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[3], need=[3], status=ProcessStatus.RUNNING)],
        total_resources=[3],
        available=[3],
        allocation_matrix=[[0]],
        max_matrix=[[3]],
        need_matrix=[[3]],
        request_queue=[],
        event_log=[],
        seed=123
    )
    engine = SimulationEngine(state)
    engine.submit_request("P1", [2])
    engine.step()
    assert state.processes[0].allocation[0] == 2
    assert state.available[0] == 1
    assert len(engine.get_event_log()) >= 2

def test_simulation_step_deny():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[3], need=[3], status=ProcessStatus.RUNNING)],
        total_resources=[3],
        available=[1],
        allocation_matrix=[[0]],
        max_matrix=[[3]],
        need_matrix=[[3]],
        request_queue=[],
        event_log=[],
        seed=123
    )
    engine = SimulationEngine(state)
    engine.submit_request("P1", [2])
    engine.step()
    assert state.processes[0].allocation[0] == 0
    assert state.available[0] == 1
    assert len(engine.get_event_log()) >= 2
