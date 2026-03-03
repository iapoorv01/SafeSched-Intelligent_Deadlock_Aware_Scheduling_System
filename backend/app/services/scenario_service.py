"""
Scenario service for SafeSched.
"""
from app.models.system_models import SystemState
from app.core.validator import validate_scenario, ScenarioValidationError

def create_scenario(state_data: dict) -> SystemState:
    """
    Creates and validates a SystemState scenario from input data.
    Raises ScenarioValidationError if invalid.
    """
    state = SystemState(**state_data)
    validate_scenario(state)
    return state
