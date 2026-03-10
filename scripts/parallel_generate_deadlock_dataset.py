"""
Parallel Deadlock Dataset Generator
- Spawns multiple processes, each generating a chunk of the dataset using generate_deadlock_dataset.py
- Merges all part CSVs into a single output file
"""
import os
import sys
import subprocess
import multiprocessing
import glob
import shutil

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), 'generate_deadlock_dataset.py')
DATASET_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'datasets'))
OUTPUT_FILE = os.path.join(DATASET_DIR, 'deadlock_train.csv')
PART_FILE_TEMPLATE = os.path.join(DATASET_DIR, 'deadlock_train_part{}.csv')

# --- CONFIGURABLE ---
NUM_RUNS = 50000  # total number of runs (override as needed)
NUM_WORKERS = max(1, multiprocessing.cpu_count() - 1)  # or set manually


def run_worker(worker_id, runs_per_worker):
    part_file = PART_FILE_TEMPLATE.format(worker_id)
    env = os.environ.copy()
    env['NUM_RUNS'] = str(runs_per_worker)
    env['DATASET_PATH'] = part_file
    # Set PYTHONPATH to project root so 'backend' is importable
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    env['PYTHONPATH'] = project_root + (os.pathsep + env['PYTHONPATH'] if 'PYTHONPATH' in env else '')
    cmd = [sys.executable, SCRIPT_PATH]
    print(f"[Worker {worker_id}] Generating {runs_per_worker} runs → {part_file}")
    subprocess.run(cmd, env=env, check=True)


def merge_csv_parts(output_file, part_files):
    print(f"Merging {len(part_files)} part files into {output_file}")
    with open(output_file, 'w', newline='') as fout:
        for i, part in enumerate(part_files):
            with open(part, 'r', newline='') as fin:
                if i == 0:
                    shutil.copyfileobj(fin, fout)
                else:
                    next(fin)  # skip header
                    shutil.copyfileobj(fin, fout)
    print(f"Merged CSV written: {output_file}")


def main():
    runs_per_worker = NUM_RUNS // NUM_WORKERS
    extra = NUM_RUNS % NUM_WORKERS
    jobs = []
    for i in range(NUM_WORKERS):
        runs = runs_per_worker + (1 if i < extra else 0)
        p = multiprocessing.Process(target=run_worker, args=(i+1, runs))
        jobs.append(p)
        p.start()
    for p in jobs:
        p.join()
    # Merge part files
    part_files = [PART_FILE_TEMPLATE.format(i+1) for i in range(NUM_WORKERS)]
    merge_csv_parts(OUTPUT_FILE, part_files)
    # Optionally, clean up part files
    for pf in part_files:
        os.remove(pf)
    print("All done.")

if __name__ == '__main__':
    main()
