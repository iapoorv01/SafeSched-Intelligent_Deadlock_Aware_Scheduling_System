"""
Scenario validation logic for SafeSched.
"""
from typing import Any
from app.models.system_models import SystemState, ProcessState
from app.models.event_models import Request

class ScenarioValidationError(Exception):
    pass

def validate_scenario(state: SystemState) -> None:
    """
    Validates the scenario for strict industry-level rules.
    Raises ScenarioValidationError with details if invalid.
    """
    # Check for negative values
    if any(r < 0 for r in state.total_resources):
        raise ScenarioValidationError("Negative value in total_resources.")
    if any(r < 0 for r in state.available):
        raise ScenarioValidationError("Negative value in available resources.")
    for row in state.allocation_matrix:
        if any(r < 0 for r in row):
            raise ScenarioValidationError("Negative value in allocation_matrix.")
    for row in state.max_matrix:
        if any(r < 0 for r in row):
            raise ScenarioValidationError("Negative value in max_matrix.")
    for row in state.need_matrix:
        if any(r < 0 for r in row):
            raise ScenarioValidationError("Negative value in need_matrix.")
    # Check allocation ≤ max_demand
    for i, proc in enumerate(state.processes):
        if any(a > m for a, m in zip(proc.allocation, proc.max_demand)):
            raise ScenarioValidationError(f"Process {proc.pid}: allocation exceeds max_demand.")
    # Check sum(allocation) + available == total_resources
    resource_count = len(state.total_resources)
    total_alloc = [0] * resource_count
    for row in state.allocation_matrix:
        for i, val in enumerate(row):
            total_alloc[i] += val
    for i in range(resource_count):
        if total_alloc[i] + state.available[i] != state.total_resources[i]:
            raise ScenarioValidationError(f"Resource {i}: allocation + available != total_resources.")
    # Check matrix dimensions
    n_proc = len(state.processes)
    n_res = len(state.total_resources)
    if not (len(state.allocation_matrix) == n_proc and all(len(row) == n_res for row in state.allocation_matrix)):
        raise ScenarioValidationError("allocation_matrix dimensions mismatch.")
    if not (len(state.max_matrix) == n_proc and all(len(row) == n_res for row in state.max_matrix)):
        raise ScenarioValidationError("max_matrix dimensions mismatch.")
    if not (len(state.need_matrix) == n_proc and all(len(row) == n_res for row in state.need_matrix)):
        raise ScenarioValidationError("need_matrix dimensions mismatch.")
    # available ≥ 0
    if any(a < 0 for a in state.available):
        raise ScenarioValidationError("Negative available resources.")
    # Consistent process count
    if len(state.processes) != len(state.allocation_matrix):
        raise ScenarioValidationError("Process count mismatch with allocation_matrix.")
