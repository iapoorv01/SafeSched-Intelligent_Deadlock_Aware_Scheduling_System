"""
Tests for event log completeness, rare edge cases, and scalability.
"""
import pytest
from app.models.system_models import ProcessStatus
from app.models.system_models import ProcessStatus
from app.models.system_models import SystemState, ProcessState
from app.models.event_models import Request
from app.core.simulation_engine import SimulationEngine
from app.core.validator import validate_scenario
from app.core.graph_builder import build_rag, build_wfg

def test_event_log_completeness():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[2], need=[2], status=ProcessStatus.RUNNING)],
        total_resources=[2],
        available=[2],
        allocation_matrix=[[0]],
        max_matrix=[[2]],
        need_matrix=[[2]],
        request_queue=[],
        event_log=[],
        seed=1
    )
    engine = SimulationEngine(state)
    engine.submit_request("P1", [1])
    engine.step()
    engine.release_resources("P1")
    log = engine.get_event_log()
    # Check all event types present
    types = {e.type for e in log}
    assert "REQUEST" in types
    assert "GRANT" in types or "WAIT" in types
    assert "RELEASE" in types
    for e in log:
        assert hasattr(e, "event_id")
        assert hasattr(e, "timestamp")
        assert hasattr(e, "type")
        assert hasattr(e, "process_id")
        assert hasattr(e, "resource_vector")
        assert hasattr(e, "details")

def test_scenario_export_import():
    import json
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[2], need=[2], status=ProcessStatus.RUNNING)],
        total_resources=[2],
        available=[2],
        allocation_matrix=[[0]],
        max_matrix=[[2]],
        need_matrix=[[2]],
        request_queue=[],
        event_log=[],
        seed=1
    )
    # Export
    data = state.model_dump()
    # Import
    state2 = SystemState(**data)
    assert state2.processes[0].pid == "P1"
    assert state2.total_resources == [2]

def test_run_auto_steps():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[2], need=[2], status=ProcessStatus.RUNNING)],
        total_resources=[2],
        available=[2],
        allocation_matrix=[[0]],
        max_matrix=[[2]],
        need_matrix=[[2]],
        request_queue=[],
        event_log=[],
        seed=1
    )
    engine = SimulationEngine(state)
    engine.submit_request("P1", [1])
    for _ in range(3):
        engine.step()
    # Should have granted and released
    assert any(e.type == "GRANT" for e in engine.get_event_log())

def test_large_system_scalability():
    n_proc = 50
    n_res = 30
    state = SystemState(
        processes=[ProcessState(pid=f"P{i}", allocation=[0]*n_res, max_demand=[1]*n_res, need=[1]*n_res, status=ProcessStatus.RUNNING) for i in range(n_proc)],
        total_resources=[n_proc]*n_res,
        available=[n_proc]*n_res,
        allocation_matrix=[[0]*n_res for _ in range(n_proc)],
        max_matrix=[[1]*n_res for _ in range(n_proc)],
        need_matrix=[[1]*n_res for _ in range(n_proc)],
        request_queue=[],
        event_log=[],
        seed=1
    )
    validate_scenario(state)
    rag = build_rag(state)
    wfg = build_wfg(state)
    assert len(rag["nodes"]) == n_proc + n_res
    assert len(wfg["nodes"]) == n_proc

def test_graph_orphan_nodes():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[0], max_demand=[1], need=[1], status=ProcessStatus.RUNNING)],
        total_resources=[1],
        available=[1],
        allocation_matrix=[[0]],
        max_matrix=[[1]],
        need_matrix=[[1]],
        request_queue=[],
        event_log=[],
        seed=1
    )
    rag = build_rag(state)
    # Should have both process and resource node, but no edges
    assert any(n["type"] == "process" for n in rag["nodes"])
    assert any(n["type"] == "resource" for n in rag["nodes"])
    assert rag["edges"] == []

def test_graph_self_loop():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1], max_demand=[2], need=[1], status=ProcessStatus.RUNNING)],
        total_resources=[2],
        available=[1],
        allocation_matrix=[[1]],
        max_matrix=[[2]],
        need_matrix=[[1]],
        request_queue=[Request(process_id="P1", resource_vector=[2])],
        event_log=[],
        seed=1
    )
    rag = build_rag(state)
    # Self-loop: process requests more than available, already holds some
    assert any(e["source"] == "P1" and e["target"] == "R0" for e in rag["edges"])
    assert any(e["source"] == "R0" and e["target"] == "P1" for e in rag["edges"])
