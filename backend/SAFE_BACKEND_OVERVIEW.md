# SafeSched Backend: File & Module Overview

This document provides a concise, research-grade overview of all core backend files in the SafeSched simulation system. It is designed for professors, researchers, and advanced users to quickly understand the architecture, responsibilities, and extensibility of each module.

---

## Core Modules

### 1. `app/core/validator.py`
- **Purpose:** Validates simulation scenarios for correctness and real-world constraints.
- **Key Features:**
  - Checks for negative values, allocation/max/total mismatches, duplicate PIDs, matrix dimension errors, and more.
  - Raises detailed errors for any invalid scenario.

### 2. `app/core/banker.py`
- **Purpose:** Implements the Banker's Algorithm for deadlock avoidance and safe sequence detection.
- **Key Features:**
  - Computes process needs and checks if a safe sequence exists.
  - Provides detailed explanation steps for each scheduling decision.

### 3. `app/core/deadlock_detector.py`
- **Purpose:** Detects deadlocks using matrix and wait-for-graph (WFG) methods.
- **Key Features:**
  - Matrix-based and WFG-based deadlock detection.
  - Cycle detection and deadlocked process reporting.

### 4. `app/core/graph_builder.py`
- **Purpose:** Builds Resource Allocation Graphs (RAG) and Wait-For Graphs (WFG) for visualization and analysis.
- **Key Features:**
  - Outputs frontend-friendly node/edge lists for graph visualization.

### 5. `app/core/request_queue.py`
- **Purpose:** Manages the advanced request queue (priority, aging, anti-starvation, fairness).
- **Key Features:**
  - Priority queue with aging, anti-starvation, and fairness logic.
  - Configurable for real-world scheduling scenarios.

### 6. `app/core/simulation_engine.py`
- **Purpose:** The main simulation engine—handles event-driven simulation, scheduling, deadlock recovery, checkpointing, and metrics.
- **Key Features:**
  - Hybrid scheduling (Banker + policy), recovery, checkpoint/rollback, metrics, plugin hooks.
  - Event log, replay, and deterministic simulation.

---

## Data Models

### 7. `app/models/system_models.py`
- **Purpose:** Defines the main system state, process state, and related data models.
- **Key Features:**
  - Strict Pydantic models for all simulation state.

### 8. `app/models/resource_models.py`
- **Purpose:** Defines resource state and checkpoint models.
- **Key Features:**
  - Tracks per-resource state and simulation checkpoints.

### 9. `app/models/event_models.py`
- **Purpose:** Defines event and request models for simulation logging and processing.
- **Key Features:**
  - Event types, request structure, and event log schema.

---

## Services & Utilities

### 10. `app/services/scenario_service.py`
- **Purpose:** Service for creating and validating simulation scenarios from input data.
- **Key Features:**
  - Scenario creation, validation, and error handling.

### 11. `app/utils/helpers.py`
- **Purpose:** Utility functions for matrix operations and deep copying.
- **Key Features:**
  - Matrix flattening, deep copy helpers.

---

## Package Structure

- `__init__.py` files: Standard Python package markers for all modules.

---

## Extensibility & Real-World Readiness
- All modules are designed for extensibility, strict validation, and real-world scheduling/research scenarios.
- Metrics, plugin hooks, and checkpointing ensure observability and robustness.
- All edge cases and real-world logic are covered, with comprehensive tests.

---

For further details, see the code comments and docstrings in each file, or contact the maintainers for advanced usage and extension.
