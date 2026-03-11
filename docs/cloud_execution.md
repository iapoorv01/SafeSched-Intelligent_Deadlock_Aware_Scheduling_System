# Cloud Execution Guide: Deadlock Dataset Generator

This guide explains how to run the deadlock dataset generator on a cloud VM or container.

## 1. Install Dependencies

- Install Python 3.9+ (recommended: 3.11)
- Install requirements:

```sh
pip install -r requirements.txt
```

## 2. Build Docker Image (Optional)

```sh
docker build -t deadlock-generator .
```

## 3. Prepare Configuration

Edit `config/generator_config.json` to set dataset parameters (number of runs, process/resource ranges, etc).

## 4. Run the Generator

### On a VM or bare metal:

```sh
python run_generator.py --runs 50000 --workers 16 --output ./datasets
```

- `--runs`: Total simulation runs (overrides config)
- `--workers`: Number of parallel workers (default: half CPU count)
- `--output`: Output directory for Parquet shards

### In Docker:

```sh
docker run --rm -v $(pwd)/datasets:/app/datasets deadlock-generator \
  python run_generator.py --runs 50000 --workers 16 --output ./datasets
```

### On Kubernetes or Ray:
- Launch multiple containers or jobs, each with its own config/output shard.
- No shared state required.

## 5. Monitor Progress

- Logs are printed to stdout and include worker ID, run ID, and simulation time.
- Each worker writes a Parquet file: `deadlock_train_part_XXXX.parquet`.

## 6. Merge Shards (Optional)

To merge all shards into a single Parquet file:

```sh
python scripts/merge_dataset_parts.py --input_dir ./datasets --output ./datasets/deadlock_train_merged.parquet
```

## 7. Cloud Storage

- To write directly to S3 or GCS, install `s3fs` or `gcsfs` and set the output path to a cloud URI (e.g., `s3://bucket/dataset_part_0001.parquet`).
- Make sure your cloud credentials are configured.

## 8. Reproducibility

- Each run is seeded for deterministic results.
- Config snapshot and determinism hash are included in the output.

---

For advanced orchestration (Kubernetes, Ray, AWS Batch), see cloud provider docs for launching parallel jobs.
