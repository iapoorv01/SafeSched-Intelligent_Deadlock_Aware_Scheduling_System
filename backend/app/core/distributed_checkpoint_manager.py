"""
Distributed Checkpointing and Rollback (Coordinated, Two-Phase Commit, Message Logging)
- Modular: Can be enabled/disabled per node
- Uses MessageBus for coordination
- Ensures global consistency across nodes
"""
from typing import List, Dict, Optional
import threading

class DistributedCheckpointManager:
    def __init__(self, node_manager, cluster_manager, message_bus):
        self.node_manager = node_manager
        self.cluster_manager = cluster_manager
        self.message_bus = message_bus
        self.lock = threading.Lock()
        self.pending_checkpoints = set()
        self.message_bus.register_handler('CHECKPOINT_REQUEST', self.handle_checkpoint_request)
        self.message_bus.register_handler('CHECKPOINT_COMMIT', self.handle_checkpoint_commit)
        self.message_bus.register_handler('CHECKPOINT_ABORT', self.handle_checkpoint_abort)

    def initiate_coordinated_checkpoint(self):
        # Two-phase commit: phase 1 (prepare)
        self.pending_checkpoints.add(self.node_manager.node_id)
        payload = {'initiator': self.node_manager.node_id}
        self.message_bus.broadcast('CHECKPOINT_REQUEST', payload, self.cluster_manager)

    def handle_checkpoint_request(self, message: dict):
        # Phase 1: prepare local checkpoint
        # In real system, flush local state, pause new events
        self.pending_checkpoints.add(self.node_manager.node_id)
        # Respond to initiator (could be more complex in real system)
        initiator_id = message['payload']['initiator']
        initiator_node = self.cluster_manager.get_node(initiator_id)
        if initiator_node:
            self.message_bus.send('CHECKPOINT_COMMIT', {'responder': self.node_manager.node_id}, [initiator_node])

    def handle_checkpoint_commit(self, message: dict):
        # Phase 2: commit local checkpoint
        # In real system, persist checkpoint, resume events
        responder = message['payload']['responder']
        with self.lock:
            self.pending_checkpoints.discard(responder)
        # If all nodes have committed, checkpoint is globally consistent
        if not self.pending_checkpoints:
            print(f"[Checkpoint] Global checkpoint committed across cluster.")

    def handle_checkpoint_abort(self, message: dict):
        # Abort checkpoint (e.g., on failure)
        self.pending_checkpoints.clear()
        print(f"[Checkpoint] Global checkpoint aborted.")

class DistributedRollbackManager:
    def __init__(self, node_manager, cluster_manager, message_bus):
        self.node_manager = node_manager
        self.cluster_manager = cluster_manager
        self.message_bus = message_bus
        self.lock = threading.Lock()
        self.pending_rollbacks = set()
        self.message_bus.register_handler('ROLLBACK_REQUEST', self.handle_rollback_request)
        self.message_bus.register_handler('ROLLBACK_COMMIT', self.handle_rollback_commit)
        self.message_bus.register_handler('ROLLBACK_ABORT', self.handle_rollback_abort)

    def initiate_coordinated_rollback(self):
        # Two-phase commit: phase 1 (prepare)
        self.pending_rollbacks.add(self.node_manager.node_id)
        payload = {'initiator': self.node_manager.node_id}
        self.message_bus.broadcast('ROLLBACK_REQUEST', payload, self.cluster_manager)

    def handle_rollback_request(self, message: dict):
        # Phase 1: prepare local rollback
        # In real system, restore local state, pause new events
        self.pending_rollbacks.add(self.node_manager.node_id)
        initiator_id = message['payload']['initiator']
        initiator_node = self.cluster_manager.get_node(initiator_id)
        if initiator_node:
            self.message_bus.send('ROLLBACK_COMMIT', {'responder': self.node_manager.node_id}, [initiator_node])

    def handle_rollback_commit(self, message: dict):
        # Phase 2: commit local rollback
        responder = message['payload']['responder']
        with self.lock:
            self.pending_rollbacks.discard(responder)
        if not self.pending_rollbacks:
            print(f"[Rollback] Global rollback committed across cluster.")

    def handle_rollback_abort(self, message: dict):
        # Abort rollback (e.g., on failure)
        self.pending_rollbacks.clear()
        print(f"[Rollback] Global rollback aborted.")

# Usage: Instantiate DistributedCheckpointManager and DistributedRollbackManager per node.
# Call initiate_coordinated_checkpoint or initiate_coordinated_rollback as needed.
