import argparse
import os
import sys
import logging

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Deadlock Dataset Generator - Cloud/Parallel CLI")
    parser.add_argument("--runs", type=int, default=None, help="Total number of simulation runs (overrides config)")
    parser.add_argument("--workers", type=int, default=None, help="Number of parallel workers (default: half CPU count)")
    parser.add_argument("--output", type=str, default=None, help="Output directory for dataset shards (default: ./datasets)")
    parser.add_argument("--config", type=str, default=None, help="Path to generator_config.json")
    args = parser.parse_args()

    # Set environment variables for the parallel generator
    if args.runs is not None:
        os.environ["NUM_RUNS"] = str(args.runs)
    if args.workers is not None:
        os.environ["NUM_WORKERS"] = str(args.workers)
    if args.output is not None:
        os.environ["OUTPUT_DIR"] = os.path.abspath(args.output)
        os.makedirs(os.environ["OUTPUT_DIR"], exist_ok=True)
    if args.config is not None:
        os.environ["GENERATOR_CONFIG"] = os.path.abspath(args.config)

    # Use logging for CLI
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    logging.info(f"Launching dataset generation: runs={os.environ.get('NUM_RUNS')}, workers={os.environ.get('NUM_WORKERS')}, output={os.environ.get('OUTPUT_DIR')}")

    # Call the parallel generator
    script_path = os.path.join(os.path.dirname(__file__), "scripts", "parallel_generate_deadlock_dataset.py")
    if not os.path.exists(script_path):
        # fallback: try in current dir
        script_path = os.path.join(os.path.dirname(__file__), "parallel_generate_deadlock_dataset.py")
    if not os.path.exists(script_path):
        logging.error("parallel_generate_deadlock_dataset.py not found!")
        sys.exit(1)
    sys.exit(os.system(f'{sys.executable} "{script_path}"'))
