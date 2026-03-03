"""
Tests for scenario export/import, replay mode, and event log determinism.
"""
import pytest
from app.models.system_models import SystemState, ProcessState, ProcessStatus
from app.models.event_models import Request
from app.core.simulation_engine import SimulationEngine
from app.core.validator import validate_scenario

def test_scenario_export_import_and_replay():
    # Initial scenario
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[2], need=[2], status=ProcessStatus.RUNNING)],
        total_resources=[2],
        available=[2],
        allocation_matrix=[[0]],
        max_matrix=[[2]],
        need_matrix=[[2]],
        request_queue=[],
        event_log=[],
        seed=123
    )
    engine = SimulationEngine(state)
    engine.submit_request("P1", [1])
    engine.step()
    engine.release_resources("P1")
    log = engine.get_event_log()
    # Export event log
    exported_log = [e.model_dump() for e in log]
    # Re-import scenario and replay
    state2 = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[2], need=[2], status=ProcessStatus.RUNNING)],
        total_resources=[2],
        available=[2],
        allocation_matrix=[[0]],
        max_matrix=[[2]],
        need_matrix=[[2]],
        request_queue=[],
        event_log=[],
        seed=123
    )
    engine2 = SimulationEngine(state2)
    # Convert dicts back to Event objects
    from app.models.event_models import Event
    imported_log = [Event(**e) for e in exported_log]
    engine2.replay(imported_log)
    # After replay, state should match (allocation, available, etc.)
    assert state2.processes[0].allocation == state.processes[0].allocation
    assert state2.available == state.available
    # Event logs should be identical in content
    assert [e.type for e in engine2.get_event_log()] == [e.type for e in log]

def test_run_auto_event_log():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[2], need=[2], status=ProcessStatus.RUNNING)],
        total_resources=[2],
        available=[2],
        allocation_matrix=[[0]],
        max_matrix=[[2]],
        need_matrix=[[2]],
        request_queue=[],
        event_log=[],
        seed=123
    )
    engine = SimulationEngine(state)
    engine.submit_request("P1", [1])
    engine.run_auto(steps=2)
    log = engine.get_event_log()
    # Should contain auto_step_marker events
    assert any((e.details or {}).get("action") == "auto_step_marker" for e in log)
