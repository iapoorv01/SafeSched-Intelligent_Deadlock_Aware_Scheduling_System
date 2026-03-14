import pandas as pd
import os

# Adjust the path if needed
dataset_path = os.path.join(os.path.dirname(__file__), '..', 'datasets', 'deadlock_train.parquet')

def main():
    df = pd.read_parquet(dataset_path)
    print("\n--- First 5 rows ---")
    print(df.head())
    print("\n--- Data types ---")
    print(df.dtypes)
    print("\n--- Summary statistics (numeric columns) ---")
    print(df.describe())
    print("\n--- Deadlock value counts ---")
    if 'deadlock' in df.columns:
        print(df['deadlock'].value_counts())
    else:
        print("Column 'deadlock' not found.")

if __name__ == "__main__":
    main()
