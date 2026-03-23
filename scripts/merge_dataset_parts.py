import os
import sys
import argparse
import pandas as pd
import pyarrow.parquet as pq
import pyarrow as pa
import glob

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Merge Parquet dataset shards into a single Parquet file.")
    parser.add_argument('--input_dir', type=str, default='./datasets', help='Directory containing dataset_part_*.parquet files')
    parser.add_argument('--output', type=str, default='./datasets/deadlock_train_merged.parquet', help='Output merged Parquet file')
    args = parser.parse_args()

    part_files = sorted(glob.glob(os.path.join(args.input_dir, 'deadlock_train_part_*.parquet')))
    if not part_files:
        print(f"No part files found in {args.input_dir}")
        sys.exit(1)

    print(f"Merging {len(part_files)} Parquet shards...")
    dfs = [pd.read_parquet(f) for f in part_files]
    merged = pd.concat(dfs, ignore_index=True)
    merged.to_parquet(args.output, index=False)
    print(f"Merged dataset written to {args.output} ({len(merged)} rows)")
