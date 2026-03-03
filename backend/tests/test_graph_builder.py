"""
Tests for graph builders (RAG + WFG).
"""
from app.models.system_models import SystemState, ProcessState
from app.models.event_models import Request
from app.core.graph_builder import build_rag, build_wfg

def test_build_rag():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1], max_demand=[3], need=[2], status="RUNNING")],
        total_resources=[3],
        available=[2],
        allocation_matrix=[[1]],
        max_matrix=[[3]],
        need_matrix=[[2]],
        request_queue=[Request(process_id="P1", resource_vector=[1])],
        event_log=[],
        seed=42
    )
    rag = build_rag(state)
    assert "nodes" in rag and "edges" in rag
    assert any(n["type"] == "resource" for n in rag["nodes"])
    assert any(n["type"] == "process" for n in rag["nodes"])

def test_build_wfg():
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1], max_demand=[3], need=[2], status="RUNNING"),
                   ProcessState(pid="P2", allocation=[0], max_demand=[2], need=[2], status="WAITING")],
        total_resources=[3],
        available=[2],
        allocation_matrix=[[1],[0]],
        max_matrix=[[3],[2]],
        need_matrix=[[2],[2]],
        request_queue=[Request(process_id="P2", resource_vector=[2])],
        event_log=[],
        seed=42
    )
    wfg = build_wfg(state)
    assert "nodes" in wfg and "edges" in wfg
    assert any(e["type"] == "wait" for e in wfg["edges"])
