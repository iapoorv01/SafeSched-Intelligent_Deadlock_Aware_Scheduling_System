"""
Graph builders for SafeSched (RAG + WFG).
"""
from typing import Dict, List, Any
from app.models.system_models import SystemState

def build_rag(state: SystemState) -> Dict[str, Any]:
    """
    Builds Resource Allocation Graph (RAG).
    Returns nodes and edges in JSON format.
    """
    nodes = []
    edges = []
    # Add resource nodes
    for i, res in enumerate(state.total_resources):
        nodes.append({"id": f"R{i}", "label": f"Resource {i}", "type": "resource"})
    # Add process nodes
    for proc in state.processes:
        nodes.append({"id": proc.pid, "label": f"Process {proc.pid}", "type": "process"})
    # Edges: allocation
    for i, proc in enumerate(state.processes):
        for j, alloc in enumerate(proc.allocation):
            if alloc > 0:
                edges.append({"source": f"R{j}", "target": proc.pid, "type": "allocation"})
    # Edges: requests
    for req in state.request_queue:
        for j, val in enumerate(req.resource_vector):
            if val > 0:
                edges.append({"source": req.process_id, "target": f"R{j}", "type": "request"})
    return {"nodes": nodes, "edges": edges}

def build_wfg(state: SystemState) -> Dict[str, Any]:
    """
    Builds Wait-For Graph (WFG).
    Returns nodes and edges in JSON format.
    """
    nodes = [{"id": proc.pid, "label": f"Process {proc.pid}", "type": "process"} for proc in state.processes]
    edges = []
    wfg = {proc.pid: [] for proc in state.processes}
    for req in state.request_queue:
        for i, avail in enumerate(state.available):
            if req.resource_vector[i] > avail:
                for proc in state.processes:
                    if proc.allocation[i] > 0:
                        edges.append({"source": req.process_id, "target": proc.pid, "type": "wait"})
    return {"nodes": nodes, "edges": edges}
