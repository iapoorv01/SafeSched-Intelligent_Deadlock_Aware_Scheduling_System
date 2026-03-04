"""
Tests for scenario validation.
"""
import pytest
from app.models.system_models import SystemState, ProcessState
from app.core.validator import validate_scenario, ScenarioValidationError

def test_valid_scenario():
    from app.models.system_models import ProcessStatus
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[1], max_demand=[3], need=[2], status=ProcessStatus.RUNNING)],
        total_resources=[4],
        available=[3],
        allocation_matrix=[[1]],
        max_matrix=[[3]],
        need_matrix=[[2]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    validate_scenario(state)

def test_invalid_negative_resources():
    from app.models.system_models import ProcessStatus
    state = SystemState(
        processes=[ProcessState(pid="P1", allocation=[-1], max_demand=[3], need=[4], status=ProcessStatus.RUNNING)],
        total_resources=[4],
        available=[3],
        allocation_matrix=[[-1]],
        max_matrix=[[3]],
        need_matrix=[[4]],
        request_queue=[],
        event_log=[],
        seed=42
    )
    with pytest.raises(ScenarioValidationError):
        validate_scenario(state)
