"""
Parallel Deadlock Dataset Generator (Cloud-Ready)
- Spawns multiple stateless workers, each generating a Parquet dataset shard using generate_deadlock_dataset.py
- No merging step by default; shards are independent for cloud-scale use.
"""

import os
import sys
import subprocess
import multiprocessing
import logging


SCRIPT_PATH = os.path.join(os.path.dirname(__file__), 'generate_deadlock_dataset.py')
DEFAULT_OUTPUT_DIR = os.environ.get('OUTPUT_DIR', os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'datasets')))
PART_FILE_TEMPLATE = os.path.join(DEFAULT_OUTPUT_DIR, 'deadlock_train_part_{:04d}.parquet')

# --- CONFIGURABLE ---
NUM_RUNS = int(os.environ.get('NUM_RUNS', '10'))
NUM_WORKERS = int(os.environ.get('NUM_WORKERS', max(1, multiprocessing.cpu_count() // 2)))

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s [worker:%(worker_id)s] %(message)s')
logger = logging.getLogger("parallel_generator")


def run_worker(worker_id, runs_per_worker):
    part_file = PART_FILE_TEMPLATE.format(worker_id)
    env = os.environ.copy()
    env['NUM_RUNS'] = str(runs_per_worker)
    env['DATASET_PATH'] = part_file
    env['WORKER_ID'] = str(worker_id)
    # Set PYTHONPATH to project root so 'backend' is importable
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    env['PYTHONPATH'] = project_root + (os.pathsep + env['PYTHONPATH'] if 'PYTHONPATH' in env else '')
    # No append mode for Parquet shards; each worker writes its own file
    env['APPEND_MODE'] = '0'
    cmd = [sys.executable, SCRIPT_PATH]
    logger.info(f"[Worker {worker_id}] Generating {runs_per_worker} runs → {part_file}", extra={'worker_id': worker_id})
    subprocess.run(cmd, env=env, check=True)



# No merging step by default. If merging is needed, use a separate script (merge_dataset_parts.py).



def main():
    runs_per_worker = NUM_RUNS // NUM_WORKERS
    extra = NUM_RUNS % NUM_WORKERS
    jobs = []
    logger.info(f"Launching {NUM_WORKERS} workers for {NUM_RUNS} total runs", extra={'worker_id': 'main'})
    for i in range(NUM_WORKERS):
        runs = runs_per_worker + (1 if i < extra else 0)
        p = multiprocessing.Process(target=run_worker, args=(i+1, runs))
        jobs.append(p)
        p.start()
    for p in jobs:
        p.join()
    logger.info(f"All workers completed. Parquet shards written to {DEFAULT_OUTPUT_DIR}", extra={'worker_id': 'main'})
    logger.info("No merging step performed. Use merge_dataset_parts.py if you need a single file.", extra={'worker_id': 'main'})

if __name__ == '__main__':
    main()
