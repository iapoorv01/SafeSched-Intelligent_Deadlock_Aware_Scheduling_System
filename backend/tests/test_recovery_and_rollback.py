"""
Advanced tests for recovery, preemption, checkpointing, and rollback in SimulationEngine.
"""
import pytest
from app.models.system_models import SystemState, ProcessState, ProcessStatus
from app.models.event_models import Request
from app.core.simulation_engine import SimulationEngine

def make_deadlock_state():
    # Two processes, each holding one resource and requesting the other's
    p1 = ProcessState(pid="P1", allocation=[1,0], max_demand=[1,1], need=[0,1], status=ProcessStatus.RUNNING)
    p2 = ProcessState(pid="P2", allocation=[0,1], max_demand=[1,1], need=[1,0], status=ProcessStatus.RUNNING)
    state = SystemState(
        processes=[p1, p2],
        total_resources=[1,1],
        available=[0,0],
        allocation_matrix=[[1,0],[0,1]],
        max_matrix=[[1,1],[1,1]],
        need_matrix=[[0,1],[1,0]],
        request_queue=[],
        event_log=[],
        checkpoints=[],
        seed=42
    )
    return state

def test_iterative_recovery_and_preemption():
    state = make_deadlock_state()
    engine = SimulationEngine(state)
    # Simulate a step that triggers deadlock and recovery
    engine.step()
    # After recovery, at least one process should be SUSPENDED or TERMINATED
    statuses = [p.status for p in state.processes]
    assert any(s in (ProcessStatus.SUSPENDED, ProcessStatus.TERMINATED) for s in statuses)
    # There should be at least one checkpoint
    assert state.checkpoints and len(state.checkpoints) > 0

def test_checkpoint_retention():
    state = make_deadlock_state()
    engine = SimulationEngine(state)
    # Create more than 10 checkpoints
    for i in range(15):
        engine.create_checkpoint(description=f"cp_{i}")
    # Only 10 should be retained
    assert state.checkpoints is not None and len(state.checkpoints) == 10

def test_rollback_loop_prevention():
    state = make_deadlock_state()
    engine = SimulationEngine(state)
    # Create 6 checkpoints, then force rollback
    for i in range(6):
        engine.create_checkpoint(description=f"cp_{i}")
    # Simulate a deadlock that cannot be resolved (no processes to preempt/terminate)
    state.processes.clear()
    # Test default (should return False, log event)
    rolled_back = engine.rollback_to_last_checkpoint()
    assert rolled_back is False
    # Check that a rollback_failed event was logged
    assert any((e.details or {}).get("action") == "rollback_failed" for e in state.event_log)
    # Test custom policy: always pick the oldest checkpoint
    def oldest_policy(checkpoints, engine):
        return 0  # always pick first
    # Add more checkpoints for this test
    for i in range(3):
        engine.create_checkpoint(description=f"cp_extra_{i}")
    state.processes.clear()
    rolled_back2 = engine.rollback_to_last_checkpoint(max_rollback=2, custom_policy=oldest_policy)
    assert rolled_back2 is False
    # Should not error, should log rollback_failed again
    assert sum(1 for e in state.event_log if (e.details or {}).get("action") == "rollback_failed") >= 2

def test_preemption_preferred_over_termination():
    """
    If a process can be preempted (suspended), it should not be terminated.
    """
    state = make_deadlock_state()
    engine = SimulationEngine(state)
    # Simulate a step that triggers deadlock and recovery
    engine.step()
    # At least one process should be SUSPENDED, none should be TERMINATED if SUSPENDED is supported
    statuses = [p.status for p in state.processes]
    assert any(s == ProcessStatus.SUSPENDED for s in statuses)
    assert all(s != ProcessStatus.TERMINATED for s in statuses)

def test_resume_suspended_process():
    """
    After preemption, a suspended process can be resumed and continue requesting resources.
    """
    state = make_deadlock_state()
    engine = SimulationEngine(state)
    # Step to cause preemption
    engine.step()
    # Find suspended process
    suspended = next((p for p in state.processes if p.status == ProcessStatus.SUSPENDED), None)
    if suspended:
        # Resume process
        suspended.status = ProcessStatus.RUNNING
        # Make a new request
        engine.submit_request(suspended.pid, [1, 0] if suspended.allocation[0] == 0 else [0, 1])
        engine.step()
        # Should be able to allocate again
        assert sum(suspended.allocation) > 0

def test_priority_and_wait_time_impact_on_recovery():
    """
    Lower-priority and long-waiting processes should be selected for recovery first.
    """
    # Two processes, one with higher priority and one with longer wait
    p1 = ProcessState(pid="P1", allocation=[1,0], max_demand=[1,1], need=[0,1], status=ProcessStatus.RUNNING, priority=10)
    p2 = ProcessState(pid="P2", allocation=[0,1], max_demand=[1,1], need=[1,0], status=ProcessStatus.RUNNING, priority=1)
    state = SystemState(
        processes=[p1, p2],
        total_resources=[1,1],
        available=[0,0],
        allocation_matrix=[[1,0],[0,1]],
        max_matrix=[[1,1],[1,1]],
        need_matrix=[[0,1],[1,0]],
        request_queue=[],
        event_log=[],
        checkpoints=[],
        seed=42
    )
    engine = SimulationEngine(state)
    # Simulate a step that triggers deadlock and recovery
    engine.step()
    # The lower-priority process (p1) should be preempted/terminated first
    assert p1.status in (ProcessStatus.SUSPENDED, ProcessStatus.TERMINATED)

def test_checkpoint_consistency_after_rollback():
    """
    After rollback, system invariants and event log should be consistent.
    """
    state = make_deadlock_state()
    engine = SimulationEngine(state)
    # Create a checkpoint, then modify state
    engine.create_checkpoint(description="before_modification")
    state.processes[0].allocation[0] = 99
    state.available[0] = -99
    # Rollback
    engine.rollback_to_last_checkpoint()
    # Invariants: allocations and available should be non-negative and match
    assert all(all(a >= 0 for a in p.allocation) for p in state.processes)
    assert all(a >= 0 for a in state.available)
    # Event log should be a list
    assert isinstance(state.event_log, list)
