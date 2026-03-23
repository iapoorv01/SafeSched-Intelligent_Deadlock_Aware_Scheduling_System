"""
Distributed Deadlock Detector (Edge-Chasing/Probe, Chandy-Misra-Haas inspired)
- Modular: Can be enabled/disabled per node
- Uses MessageBus for probe messages
- Detects cycles spanning multiple nodes
"""
from typing import List, Dict, Optional
import threading

class DistributedDeadlockDetector:
    def __init__(self, node_manager, cluster_manager, message_bus):
        self.node_manager = node_manager
        self.cluster_manager = cluster_manager
        self.message_bus = message_bus
        self.active_probes = set()  # (initiator, sender, receiver)
        self.lock = threading.Lock()
        # Register probe handler
        self.message_bus.register_handler('PROBE', self.handle_probe)

    def initiate_probe(self, initiator_id: str, waiting_for_id: str):
        # Start a probe if this node is waiting for another node
        probe = (initiator_id, self.node_manager.node_id, waiting_for_id)
        with self.lock:
            self.active_probes.add(probe)
        payload = {'initiator': initiator_id, 'sender': self.node_manager.node_id, 'receiver': waiting_for_id}
        target_node = self.cluster_manager.get_node(waiting_for_id)
        if target_node:
            self.message_bus.send('PROBE', payload, [target_node])

    def handle_probe(self, message: dict):
        payload = message.get('payload', {})
        initiator = payload.get('initiator')
        sender = payload.get('sender')
        receiver = payload.get('receiver')
        # If probe returns to initiator, deadlock detected
        if receiver == self.node_manager.node_id and initiator == self.node_manager.node_id:
            # Deadlock detected involving this node
            print(f"[Deadlock Detected] Node {self.node_manager.node_id} is in a distributed deadlock cycle.")
            # In real system, trigger recovery here
            return
        # Forward probe if this node is waiting for another node
        waiting_for = self.get_waiting_for_nodes()
        for next_receiver in waiting_for:
            if (initiator, self.node_manager.node_id, next_receiver) not in self.active_probes:
                self.initiate_probe(initiator, next_receiver)

    def get_waiting_for_nodes(self) -> List[str]:
        # Should return list of node_ids this node is waiting for (from local WFG)
        # Not implemented: must be integrated with local simulation engine's WFG
        raise NotImplementedError("get_waiting_for_nodes must be implemented to return node dependencies.")

# Usage: Instantiate DistributedDeadlockDetector per node, integrate with local WFG
# and call initiate_probe when local deadlock suspicion arises.
