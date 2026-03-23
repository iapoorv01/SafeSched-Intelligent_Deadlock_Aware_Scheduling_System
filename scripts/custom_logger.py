# Example: User custom event logger plugin for SafeSched dataset generator
# Place this file as scripts/custom_logger.py to add custom logging/side effects per scenario

def log_event(state, run_id, scenario_seed, features):
    # User can implement any custom logging, monitoring, or side effects here
    # Example: Print a summary for every 1000th run
    # Find the index of 'deadlock' field in features (robust to field order)
    deadlock_idx = None
    try:
        # The generator always outputs a header row as FEATURES, so use the same order
        # 'deadlock' is always present, but its index may change if FEATURES changes
        # For safety, infer index from the header row if available
        # Here, we assume 'deadlock' is at index 44 (after version, scenario_id, ...), but let's search for it
        header = [
            'version', 'scenario_id', 'run_id', 'scenario_seed', 'num_processes', 'num_resources', 'total_resources',
            'workload_pattern', 'distributed', 'resource_types', 'process_types', 'resource_details',
            'preemption_events', 'checkpoint_recovery_events', 'distributed_events', 'allocation_release_events',
            'process_aging_metrics', 'process_starvation_metrics', 'scheduling_policy', 'policy_params',
            'deadlock_detection_method', 'deadlock_cycle_length', 'deadlock_resource_types', 'full_event_log',
            'failure_recovery_outcomes', 'user_fairness_metrics', 'group_fairness_metrics', 'simulation_parameters',
            'meta_coverage_metrics', 'meta_determinism_hash', 'meta_config_snapshot', 'meta_edge_case_summary',
            'avg_allocation', 'avg_max', 'avg_need', 'avg_waiting', 'max_waiting', 'min_waiting', 'event_count',
            'deadlock', 'deadlock_type', 'deadlock_processes', 'deadlock_resources', 'time_to_deadlock', 'edge_case',
            'failure_injected', 'starved_processes', 'blocked_processes', 'dynamic_join_leave', 'failure_type',
            'event_trace_hash', 'sim_time_ms'
        ]
        deadlock_idx = header.index('deadlock')
    except Exception:
        deadlock_idx = 38  # fallback to known index if header changes
    if run_id % 1000 == 0:
        print(f"[CustomLogger] Run {run_id}: scenario_seed={scenario_seed}, features[deadlock]={features[deadlock_idx]}")
