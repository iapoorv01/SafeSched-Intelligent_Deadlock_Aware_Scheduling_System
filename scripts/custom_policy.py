# Example: User custom policy plugin for SafeSched dataset generator
# Place this file as scripts/custom_policy.py to override scheduling policy selection

def get_policy(state, run_id, scenario_seed):
    # User can implement any logic here using state, run_id, scenario_seed
    # Example: Always use round_robin with quantum=5
    return 'round_robin', {'quantum': 5}
