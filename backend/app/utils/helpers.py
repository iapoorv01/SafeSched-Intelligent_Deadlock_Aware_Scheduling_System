"""
Helper utilities for SafeSched.
"""
from typing import Any

def flatten_matrix(matrix):
    return [item for row in matrix for item in row]

def deep_copy(obj: Any) -> Any:
    import copy
    return copy.deepcopy(obj)
