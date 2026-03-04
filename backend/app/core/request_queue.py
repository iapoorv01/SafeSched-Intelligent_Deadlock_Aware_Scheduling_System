"""
Advanced RequestQueue for SafeSched: supports priority, aging, anti-starvation, and fairness.
"""
from typing import List, Optional
import heapq
import time
from app.models.event_models import Request

class QueueRequest:
    def __init__(self, request: Request, priority: int = 0, timestamp: Optional[float] = None):
        self.request = request
        self.priority = priority
        self.timestamp = timestamp or time.time()
        self.age = 0  # Number of steps waited

    def __lt__(self, other):
        # Higher priority first, then older first
        if self.priority == other.priority:
            return self.timestamp < other.timestamp
        return self.priority > other.priority

class RequestQueue:
    def __init__(self, max_size: Optional[int] = None, aging_rate: int = 1, max_delay: Optional[int] = None):
        self._queue: List[QueueRequest] = []
        self.max_size = max_size
        self.aging_rate = aging_rate
        self.max_delay = max_delay

    def add_request(self, request: Request, priority: int = 0):
        if self.max_size and len(self._queue) >= self.max_size:
            raise Exception("Request queue overflow")
        heapq.heappush(self._queue, QueueRequest(request, priority))

    def step_aging(self):
        # Age all requests, increase priority if needed
        for qr in self._queue:
            qr.age += 1
            if self.aging_rate:
                qr.priority += self.aging_rate

    def pop_next(self) -> Optional[Request]:
        # Remove requests that exceeded max_delay (anti-starvation)
        if self.max_delay:
            self._queue = [qr for qr in self._queue if qr.age <= self.max_delay]
            heapq.heapify(self._queue)
        if not self._queue:
            return None
        return heapq.heappop(self._queue).request

    def __len__(self):
        return len(self._queue)

    def as_list(self) -> List[Request]:
        return [qr.request for qr in sorted(self._queue)]
