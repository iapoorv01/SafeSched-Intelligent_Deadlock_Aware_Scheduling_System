"""
Tests for advanced RequestQueue: priority, aging, anti-starvation, fairness.
"""
import pytest
import time
from app.core.request_queue import RequestQueue
from app.models.event_models import Request

def test_priority_queue():
    rq = RequestQueue()
    rq.add_request(Request(process_id="P1", resource_vector=[1]), priority=1)
    rq.add_request(Request(process_id="P2", resource_vector=[1]), priority=5)
    rq.add_request(Request(process_id="P3", resource_vector=[1]), priority=3)
    order = []
    for _ in range(3):
        req = rq.pop_next()
        if req is not None:
            order.append(req.process_id)
    assert order == ["P2", "P3", "P1"]

def test_aging_increases_priority():
    rq = RequestQueue(aging_rate=2)
    rq.add_request(Request(process_id="P1", resource_vector=[1]), priority=1)
    rq.add_request(Request(process_id="P2", resource_vector=[1]), priority=1)
    for _ in range(3):
        rq.step_aging()
    # Both should have higher priority now, but order by timestamp
    order = []
    for _ in range(2):
        req = rq.pop_next()
        if req is not None:
            order.append(req.process_id)
    assert set(order) == {"P1", "P2"}

def test_anti_starvation_max_delay():
    rq = RequestQueue(max_delay=2)
    rq.add_request(Request(process_id="P1", resource_vector=[1]), priority=1)
    for _ in range(3):
        rq.step_aging()
    # Should be removed due to max_delay
    assert rq.pop_next() is None

def test_queue_overflow():
    rq = RequestQueue(max_size=2)
    rq.add_request(Request(process_id="P1", resource_vector=[1]))
    rq.add_request(Request(process_id="P2", resource_vector=[1]))
    with pytest.raises(Exception):
        rq.add_request(Request(process_id="P3", resource_vector=[1]))

def test_fairness_priority_and_aging():
    rq = RequestQueue(aging_rate=1)
    rq.add_request(Request(process_id="P1", resource_vector=[1]), priority=1)
    rq.add_request(Request(process_id="P2", resource_vector=[1]), priority=2)
    rq.step_aging()
    rq.add_request(Request(process_id="P3", resource_vector=[1]), priority=0)
    # After aging, P1's priority increases
    order = []
    for _ in range(3):
        req = rq.pop_next()
        if req is not None:
            order.append(req.process_id)
    assert "P1" in order and "P2" in order and "P3" in order
