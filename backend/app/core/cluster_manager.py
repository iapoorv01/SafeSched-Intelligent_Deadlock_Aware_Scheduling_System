"""
NodeManager and ClusterManager for distributed/multi-node SafeSched
- NodeManager: Handles node identity, local state, and communication
- ClusterManager: Tracks cluster membership, node status, and coordination
- Modular: All distributed logic is optional; single-node mode is default
"""
from typing import Dict, List, Optional, Callable
import threading
import uuid

class NodeManager:
    def __init__(self, node_id: Optional[str] = None, address: Optional[str] = None):
        self.node_id = node_id or str(uuid.uuid4())
        self.address = address or "localhost"
        self.status = "ACTIVE"  # ACTIVE, INACTIVE, FAILED
        self.role = "WORKER"    # WORKER, LEADER, etc.
        self.local_state = None # Reference to local simulation engine/state
        self.message_handler: Optional[Callable] = None

    def set_local_state(self, state):
        self.local_state = state

    def set_message_handler(self, handler: Callable):
        self.message_handler = handler

    def receive_message(self, message: dict):
        if self.message_handler:
            self.message_handler(message)

    def send_message(self, target_node, message: dict):
        # In real deployment, this would use RPC, REST, or a message bus
        # For now, call directly if in same process (for test/dev)
        target_node.receive_message(message)

class ClusterManager:
    def __init__(self):
        self.nodes: Dict[str, NodeManager] = {}
        self.leader_id: Optional[str] = None
        self.lock = threading.Lock()

    def add_node(self, node: NodeManager):
        with self.lock:
            self.nodes[node.node_id] = node
            if not self.leader_id:
                self.leader_id = node.node_id

    def remove_node(self, node_id: str):
        with self.lock:
            if node_id in self.nodes:
                del self.nodes[node_id]
                if self.leader_id == node_id:
                    self.leader_id = next(iter(self.nodes), None)

    def get_node(self, node_id: str) -> Optional[NodeManager]:
        return self.nodes.get(node_id)

    def broadcast(self, message: dict):
        for node in self.nodes.values():
            node.receive_message(message)

    def get_leader(self) -> Optional[NodeManager]:
        if self.leader_id:
            return self.nodes.get(self.leader_id)
        return None

    def get_active_nodes(self) -> List[NodeManager]:
        return [n for n in self.nodes.values() if n.status == "ACTIVE"]

    def elect_leader(self):
        # Simple leader election: pick first ACTIVE node
        for node in self.nodes.values():
            if node.status == "ACTIVE":
                self.leader_id = node.node_id
                break

class MessageBus:
    """
    Real-world inspired message bus for inter-node communication.
    - Supports async message delivery, handler registration, and message types.
    - Can be replaced with REST, gRPC, or message queue in production.
    """
    def __init__(self):
        self.handlers = {}
        self.lock = threading.Lock()

    def register_handler(self, message_type: str, handler: Callable):
        with self.lock:
            if message_type not in self.handlers:
                self.handlers[message_type] = []
            self.handlers[message_type].append(handler)

    def send(self, message_type: str, payload: dict, target_nodes: Optional[List['NodeManager']] = None):
        # In real world, this would be async and networked
        if target_nodes is None:
            return
        for node in target_nodes:
            node.receive_message({'type': message_type, 'payload': payload})

    def broadcast(self, message_type: str, payload: dict, cluster_manager: 'ClusterManager'):
        for node in cluster_manager.get_active_nodes():
            node.receive_message({'type': message_type, 'payload': payload})

# Usage: Import NodeManager/ClusterManager in simulation engine or API layer
# and use for distributed coordination. All distributed logic is optional.
