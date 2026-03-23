import unittest
import os
import sys
import json
import importlib.util

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../scripts')))

from generate_deadlock_dataset import validate_and_repair_scenario, random_scenario

class TestDeadlockDatasetGenerator(unittest.TestCase):
    def test_scenario_validation_no_negatives(self):
        # Create a scenario with negative resources
        state, _, _ = random_scenario(42)
        state.total_resources[0] = -5
        valid, repair_log = validate_and_repair_scenario(state)
        self.assertTrue(valid)
        self.assertIn('total_resources[0] set to', ';'.join(repair_log))

    def test_scenario_validation_allocation_overflow(self):
        state, _, _ = random_scenario(43)
        # Force allocation overflow
        for i in range(len(state.allocation_matrix)):
            for j in range(len(state.allocation_matrix[0])):
                state.allocation_matrix[i][j] += 100
                state.processes[i].allocation[j] = state.allocation_matrix[i][j]
        valid, repair_log = validate_and_repair_scenario(state)
        self.assertTrue(valid)
        self.assertIn('alloc_matrix', ';'.join(repair_log))

    def test_scenario_validation_invalid_counts(self):
        state, _, _ = random_scenario(44)
        state.total_resources = [1]
        valid, repair_log = validate_and_repair_scenario(state)
        self.assertFalse(valid)
        self.assertIn('invalid process/resource count', ';'.join(repair_log))

    def test_scenario_validation_allocation_vs_max(self):
        state, _, _ = random_scenario(45)
        for p in state.processes:
            for j in range(len(p.allocation)):
                p.allocation[j] = p.max_demand[j] + 5
        valid, repair_log = validate_and_repair_scenario(state)
        self.assertTrue(valid)
        self.assertIn('capped to max_demand', ';'.join(repair_log))

if __name__ == '__main__':
    unittest.main()
