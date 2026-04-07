"""
Preprocess SafeSched deadlock dataset for prevention-focused model training.

This script is intentionally simple and practical:
- It keeps only the minimum pre-outcome features needed for prevention modeling.
- It removes unnecessary/leaky columns by feature selection policy.
- It cleans target labels, drops duplicates, and imputes missing values.
- It exports a cleaned CSV and a JSON report that explains every preprocessing step.
"""

# Standard library imports for CLI arguments, JSON report writing, and file paths.
import ast
import argparse
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Third-party import for tabular preprocessing.
import numpy as np
import pandas as pd


# Base features to keep from source data.
RECOMMENDED_PREVENTION_FEATURES: List[str] = [
    "num_processes",
    "num_resources",
    "distributed",
    "dynamic_join_leave",
]


# Engineered pre-deadlock features used by training and API inference.
ENGINEERED_PREVENTION_FEATURES: List[str] = [
    "total_allocation",
    "total_max",
    "total_need",
    "total_available",
    "num_executable_processes",
    "blocked_processes",
    "fraction_blocked",
    "utilization_ratio",
    "need_to_available_ratio",
]


FINAL_PREVENTION_FEATURES: List[str] = (
    RECOMMENDED_PREVENTION_FEATURES + ENGINEERED_PREVENTION_FEATURES
)


# Features excluded by default due likely leakage/proxy behavior in this dataset.
HIGH_RISK_PROXY_FEATURES: List[str] = [
    "resource_types",
    "process_types",
    "resource_details",
    "edge_case",
    "failure_type",
]


# Columns we consider clearly leaky or unnecessary for prevention-time prediction.
# These include post-outcome signals, IDs/hashes, and very high-cardinality event traces.
LEAKY_OR_UNNECESSARY_CANDIDATES: List[str] = [
    "version",
    "scenario_id",
    "run_id",
    "scenario_seed",
    "preemption_events",
    "checkpoint_recovery_events",
    "distributed_events",
    "allocation_release_events",
    "process_aging_metrics",
    "process_starvation_metrics",
    "deadlock_detection_method",
    "deadlock_cycle_length",
    "deadlock_resource_types",
    "full_event_log",
    "failure_recovery_outcomes",
    "user_fairness_metrics",
    "group_fairness_metrics",
    "simulation_parameters",
    "meta_coverage_metrics",
    "meta_determinism_hash",
    "meta_config_snapshot",
    "meta_edge_case_summary",
    "avg_allocation",
    "avg_max",
    "avg_need",
    "avg_waiting",
    "max_waiting",
    "min_waiting",
    "event_count",
    "deadlock_type",
    "deadlock_processes",
    "deadlock_resources",
    "time_to_deadlock",
    "starved_processes",
    "blocked_processes",
    "event_trace_hash",
    "sim_time_ms",
]


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for flexible input/output file paths."""
    parser = argparse.ArgumentParser(
        description="Preprocess dead_data.csv for prevention-focused deadlock modeling."
    )

    # Input raw dataset path.
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("datasets/dead_data.csv"),
        help="Path to raw CSV dataset.",
    )

    # Output cleaned dataset path.
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("datasets/dead_data_preprocessed.csv"),
        help="Path to write cleaned CSV dataset.",
    )

    # Output JSON report path.
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("datasets/dead_data_preprocess_report.json"),
        help="Path to write preprocessing report JSON.",
    )

    # Target column name so the script can be reused if needed.
    parser.add_argument(
        "--target",
        type=str,
        default="deadlock",
        help="Name of binary target column.",
    )

    # Optional pattern-level deduplication to reduce repeated feature vectors.
    parser.add_argument(
        "--deduplicate-patterns",
        action="store_true",
        help=(
            "If set, cap each repeated feature pattern to one row. "
            "This is optional; training also uses pattern-aware splitting."
        ),
    )

    # Cap rows per repeated feature vector to reduce overrepresented patterns.
    parser.add_argument(
        "--max-pattern-frequency",
        type=int,
        default=100,
        help="Maximum rows to keep per identical feature vector (excluding target).",
    )

    # Keep post-diversification class ratio close to balanced.
    parser.add_argument(
        "--balance-tolerance",
        type=float,
        default=1.0,
        help="Allowed class ratio difference before majority-class downsampling.",
    )

    # Optional small noise for supported numeric columns (if present).
    parser.add_argument(
        "--noise-pct",
        type=float,
        default=0.0,
        help="Relative noise for avg_* numeric features (e.g. 0.02 means +/-2%%).",
    )

    # Seed used for capping, balancing, noise and shuffling.
    parser.add_argument(
        "--shuffle-random-state",
        type=int,
        default=42,
        help="Random seed for diversity operations.",
    )

    return parser.parse_args()


def normalize_target_column(series: pd.Series) -> pd.Series:
    """
    Normalize target values to {0, 1}.

    Accepted values include common representations like:
    - integers: 0, 1
    - booleans: True, False
    - strings: "0", "1", "true", "false", "yes", "no"

    Invalid or unknown values become <NA> and will be dropped.
    """
    # Mapping used for canonical binary conversion.
    mapping = {
        "0": 0,
        "1": 1,
        "false": 0,
        "true": 1,
        "no": 0,
        "yes": 1,
    }

    # Convert everything to lower-case string for robust mapping.
    normalized = (
        series.astype(str)
        .str.strip()
        .str.lower()
        .map(mapping)
    )

    # Preserve existing numeric 0/1 values if mapping missed them.
    numeric = pd.to_numeric(series, errors="coerce")
    normalized = normalized.where(normalized.notna(), numeric)

    # Keep only 0/1; all others are invalid.
    normalized = normalized.where(normalized.isin([0, 1]), pd.NA)

    # Return as nullable integer for clean reporting and CSV output.
    return normalized.astype("Int64")


def _safe_numeric(series: pd.Series, fallback: float = 0.0) -> pd.Series:
    """Convert series to numeric and replace non-finite values safely."""
    values = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)
    return values.fillna(fallback)


def _parse_blocked_count(raw_value) -> Optional[int]:
    """Parse blocked process count from scalar/list-like text fields."""
    if pd.isna(raw_value):
        return None

    if isinstance(raw_value, (int, np.integer)):
        return max(int(raw_value), 0)

    if isinstance(raw_value, float):
        if np.isnan(raw_value):
            return None
        return max(int(raw_value), 0)

    if isinstance(raw_value, str):
        text = raw_value.strip()
        if not text:
            return None
        if text.lower() in {"nan", "none", "null"}:
            return None

        for parser in (json.loads, ast.literal_eval):
            try:
                parsed = parser(text)
                if isinstance(parsed, list):
                    return len(parsed)
                if isinstance(parsed, (int, float)):
                    return max(int(parsed), 0)
            except (json.JSONDecodeError, ValueError, SyntaxError, TypeError):
                continue

        # Fallback for loose comma-separated IDs without brackets.
        tokens = [token.strip() for token in text.split(",") if token.strip()]
        if tokens:
            return len(tokens)

    return None


def engineer_prevention_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, object]]:
    """
    Engineer meaningful pre-deadlock features without using post-outcome leakage.

    Primary formulas use matrix-like aggregates:
    - total_allocation
    - total_max
    - total_need
    - total_available
    - num_executable_processes
    - blocked_processes
    - fraction_blocked
    - utilization_ratio
    - need_to_available_ratio
    """
    engineered_df = df.copy()

    num_processes = _safe_numeric(engineered_df.get("num_processes", pd.Series(dtype=float)), 1.0).clip(lower=1.0)
    total_resources = _safe_numeric(engineered_df.get("total_resources", pd.Series(dtype=float)), 0.0).clip(lower=0.0)

    avg_allocation = _safe_numeric(engineered_df.get("avg_allocation", pd.Series(dtype=float)), 0.0).clip(lower=0.0)
    avg_max = _safe_numeric(engineered_df.get("avg_max", pd.Series(dtype=float)), 0.0).clip(lower=0.0)
    avg_need = _safe_numeric(engineered_df.get("avg_need", pd.Series(dtype=float)), 0.0).clip(lower=0.0)

    total_allocation = (avg_allocation * num_processes).clip(lower=0.0)
    total_max = (avg_max * num_processes).clip(lower=0.0)
    fallback_total_need = (avg_need * num_processes).clip(lower=0.0)
    total_need = (total_max - total_allocation).clip(lower=0.0)
    total_need = total_need.where(total_need > 0.0, fallback_total_need)
    total_need = total_need.clip(lower=0.0)

    total_available = (total_resources - total_allocation).clip(lower=0.0)

    blocked_from_column = None
    blocked_from_column_count = 0
    if "blocked_processes" in engineered_df.columns:
        blocked_from_column = engineered_df["blocked_processes"].apply(_parse_blocked_count)
        blocked_from_column_count = int(blocked_from_column.notna().sum())

    # If blocked count is unavailable, approximate executability from demand vs available supply.
    avg_need_nonzero = avg_need.where(avg_need > 1e-9, 1e-9)
    estimated_executable = np.floor(total_available / avg_need_nonzero)
    estimated_executable = estimated_executable.clip(lower=0.0, upper=num_processes).astype(int)

    if blocked_from_column is not None and blocked_from_column_count > 0:
        blocked_count_series = blocked_from_column.fillna((num_processes - estimated_executable).clip(lower=0.0)).astype(float)
    else:
        blocked_count_series = (num_processes - estimated_executable).clip(lower=0.0).astype(float)

    blocked_count_series = blocked_count_series.clip(lower=0.0, upper=num_processes).astype(int)
    num_executable_processes = (num_processes - blocked_count_series).clip(lower=0.0).astype(int)

    fraction_blocked = np.where(num_processes > 0, blocked_count_series / num_processes, 0.0)
    utilization_ratio = np.where(total_resources > 0, total_allocation / total_resources, 0.0)
    need_to_available_ratio = np.where(total_available > 1e-9, total_need / total_available, total_need)

    engineered_df["total_allocation"] = total_allocation.astype(float)
    engineered_df["total_max"] = total_max.astype(float)
    engineered_df["total_need"] = total_need.astype(float)
    engineered_df["total_available"] = total_available.astype(float)
    engineered_df["num_executable_processes"] = num_executable_processes.astype(float)
    engineered_df["blocked_processes"] = blocked_count_series.astype(float)
    engineered_df["fraction_blocked"] = pd.Series(fraction_blocked).astype(float)
    engineered_df["utilization_ratio"] = pd.Series(utilization_ratio).astype(float)
    engineered_df["need_to_available_ratio"] = pd.Series(need_to_available_ratio).astype(float)

    return engineered_df, {
        "engineered_features": ENGINEERED_PREVENTION_FEATURES,
        "blocked_count_rows_from_source_column": blocked_from_column_count,
        "used_matrix_columns": all(
            column in df.columns for column in ["allocation_matrix", "max_matrix", "available"]
        ),
        "used_aggregate_fallback_columns": {
            "avg_allocation": "avg_allocation" in df.columns,
            "avg_max": "avg_max" in df.columns,
            "avg_need": "avg_need" in df.columns,
            "total_resources": "total_resources" in df.columns,
        },
    }


def align_deadlock_target_semantics(
    df: pd.DataFrame,
    target_col: str,
) -> Tuple[pd.DataFrame, Dict[str, object]]:
    """
    Align target semantics so deadlock=1 reflects lower executability / higher blocking.

    If label 1 shows higher executability than label 0, labels are inverted.
    """
    out_df = df.copy()

    info: Dict[str, object] = {
        "applied": False,
        "reason": "insufficient class statistics",
        "mean_num_executable_by_label": {},
        "mean_fraction_blocked_by_label": {},
    }

    if target_col not in out_df.columns:
        info["reason"] = "target column missing"
        return out_df, info

    if "num_executable_processes" not in out_df.columns or "fraction_blocked" not in out_df.columns:
        info["reason"] = "required engineered columns missing"
        return out_df, info

    if out_df[target_col].nunique() < 2:
        info["reason"] = "single-class target"
        return out_df, info

    exec_means = out_df.groupby(target_col)["num_executable_processes"].mean().to_dict()
    blocked_means = out_df.groupby(target_col)["fraction_blocked"].mean().to_dict()

    info["mean_num_executable_by_label"] = {
        str(int(k)): float(v) for k, v in exec_means.items()
    }
    info["mean_fraction_blocked_by_label"] = {
        str(int(k)): float(v) for k, v in blocked_means.items()
    }

    exec0 = exec_means.get(0)
    exec1 = exec_means.get(1)
    blocked0 = blocked_means.get(0)
    blocked1 = blocked_means.get(1)

    if exec0 is None or exec1 is None or blocked0 is None or blocked1 is None:
        info["reason"] = "missing one class in aggregate stats"
        return out_df, info

    # Deadlock class should exhibit fewer executable processes and more blocking.
    likely_inverted = (exec1 > exec0) and (blocked1 < blocked0)

    if likely_inverted:
        out_df[target_col] = 1 - out_df[target_col].astype(int)
        info["applied"] = True
        info["reason"] = "label orientation inverted to match feasibility semantics"
    else:
        info["reason"] = "existing orientation already aligned"

    return out_df, info


def split_feature_types(df: pd.DataFrame, feature_cols: List[str]) -> Tuple[List[str], List[str]]:
    """Split selected features into numeric and categorical lists."""
    # Numeric features are used with median imputation.
    numeric_cols = [
        col for col in feature_cols if pd.api.types.is_numeric_dtype(df[col])
    ]

    # Non-numeric features are treated as categorical/text.
    categorical_cols = [
        col for col in feature_cols if col not in numeric_cols
    ]

    return numeric_cols, categorical_cols


def impute_missing_values(df: pd.DataFrame, feature_cols: List[str]) -> Dict[str, int]:
    """
    Impute missing values in-place using simple, stable defaults.

    Strategy:
    - Numeric columns: median (or 0 if median is NaN due to all-missing).
    - Categorical columns: "unknown" token.

    Returns a dictionary of missing-value counts after imputation.
    """
    # Determine numeric/categorical split for appropriate imputation rules.
    numeric_cols, categorical_cols = split_feature_types(df, feature_cols)

    # Numeric imputation with median keeps central tendency and is robust to outliers.
    for col in numeric_cols:
        median_value = df[col].median(skipna=True)

        # If an entire numeric column is missing, fallback to 0.
        if pd.isna(median_value):
            median_value = 0

        # Fill missing numeric values.
        df[col] = df[col].fillna(median_value)

    # Categorical imputation uses an explicit placeholder token.
    for col in categorical_cols:
        df[col] = df[col].astype("string").fillna("unknown")

    # Report remaining missing values after imputation.
    return df[feature_cols].isna().sum().astype(int).to_dict()


def cap_pattern_frequency(
    df: pd.DataFrame,
    feature_cols: List[str],
    max_pattern_frequency: int,
    random_state: int,
) -> Tuple[pd.DataFrame, int]:
    """Limit overrepresented feature vectors to at most N rows."""
    if not feature_cols or df.empty:
        return df.copy(), 0

    capped_df = df.sample(frac=1.0, random_state=random_state).reset_index(drop=True).copy()
    capped_df["_pattern_key"] = capped_df[feature_cols].astype(str).agg("||".join, axis=1)
    capped_df["_rank"] = capped_df.groupby("_pattern_key").cumcount()

    before_rows = len(capped_df)
    capped_df = capped_df[capped_df["_rank"] < int(max_pattern_frequency)].copy()
    removed_rows = before_rows - len(capped_df)
    capped_df.drop(columns=["_rank", "_pattern_key"], inplace=True)
    return capped_df, removed_rows


def enforce_class_balance(
    df: pd.DataFrame,
    target_col: str,
    balance_tolerance: float,
    random_state: int,
) -> Tuple[pd.DataFrame, Dict]:
    """Downsample majority class only when imbalance exceeds tolerance."""
    info = {
        "applied": False,
        "before": df[target_col].value_counts().sort_index().astype(int).to_dict() if not df.empty else {},
        "after": {},
    }

    if df.empty:
        return df.copy(), info

    counts = df[target_col].value_counts()
    if len(counts) < 2:
        info["after"] = info["before"]
        return df.copy(), info

    majority_label = counts.idxmax()
    minority_label = counts.idxmin()
    majority_count = int(counts.max())
    minority_count = int(counts.min())
    imbalance_ratio = (majority_count - minority_count) / max(1, len(df))

    if imbalance_ratio <= float(balance_tolerance):
        info["after"] = info["before"]
        return df.copy(), info

    minority_df = df[df[target_col] == minority_label].copy()
    majority_df = df[df[target_col] == majority_label].sample(
        n=minority_count,
        random_state=random_state,
    )
    balanced_df = pd.concat([minority_df, majority_df], ignore_index=True)
    balanced_df = balanced_df.sample(frac=1.0, random_state=random_state).reset_index(drop=True)

    info["applied"] = True
    info["after"] = balanced_df[target_col].value_counts().sort_index().astype(int).to_dict()
    return balanced_df, info


def apply_controlled_noise(
    df: pd.DataFrame,
    noise_pct: float,
    random_state: int,
) -> Tuple[pd.DataFrame, List[str]]:
    """Apply small bounded noise to avg_* numeric columns when present."""
    if df.empty or noise_pct <= 0:
        return df.copy(), []

    noisy_df = df.copy()
    rng = np.random.default_rng(seed=random_state)
    applied_cols: List[str] = []
    candidate_cols = ["avg_allocation", "avg_max", "avg_need", "total_resources"]

    for col in candidate_cols:
        if col not in noisy_df.columns:
            continue
        if not pd.api.types.is_numeric_dtype(noisy_df[col]):
            continue
        scale = rng.uniform(-abs(noise_pct), abs(noise_pct), size=len(noisy_df))
        noisy_df[col] = (pd.to_numeric(noisy_df[col], errors="coerce").fillna(0.0) * (1.0 + scale)).clip(lower=0.0)
        # Preserve integer semantics for resource totals.
        if col == "total_resources":
            noisy_df[col] = noisy_df[col].round().clip(lower=1).astype(int)
        applied_cols.append(col)

    # Keep simple consistency with avg_max if available.
    if "avg_max" in noisy_df.columns and "avg_allocation" in noisy_df.columns:
        noisy_df["avg_allocation"] = np.minimum(noisy_df["avg_allocation"], noisy_df["avg_max"])
    if "avg_max" in noisy_df.columns and "avg_need" in noisy_df.columns:
        noisy_df["avg_need"] = np.minimum(noisy_df["avg_need"], noisy_df["avg_max"])

    return noisy_df, applied_cols


def compute_pattern_diagnostics(
    cleaned_df: pd.DataFrame,
    feature_cols: List[str],
    target_col: str,
) -> Dict:
    """
    Compute pattern-level diagnostics that help detect suspiciously easy datasets.

    Why this matters:
    - Very few unique feature patterns can cause near-memorization.
    - Zero label conflicts for repeated patterns can make models look unrealistically perfect.
    - This is not always a bug, but it is a strong evaluation red flag.
    """
    # If no features are present, return an empty diagnostic payload.
    if not feature_cols:
        return {
            "unique_feature_patterns": 0,
            "conflicting_patterns": 0,
            "max_pattern_frequency": 0,
            "pattern_to_row_ratio": 0.0,
            "patterns_per_class": {},
            "row_shuffle_needed_for_training": False,
            "notes": ["No feature columns available for pattern diagnostics."],
        }

    # Build one string key per row so identical feature vectors map to one pattern key.
    pattern_key = cleaned_df[feature_cols].astype(str).agg("||".join, axis=1)

    # Aggregate pattern statistics.
    pattern_stats = (
        pd.DataFrame({"pattern": pattern_key, "target": cleaned_df[target_col]})
        .groupby("pattern", dropna=False)["target"]
        .agg(["count", "nunique", "mean"])
        .reset_index()
    )

    unique_patterns = int(len(pattern_stats))
    conflicting_patterns = int((pattern_stats["nunique"] > 1).sum())
    max_pattern_frequency = int(pattern_stats["count"].max()) if unique_patterns > 0 else 0
    pattern_to_row_ratio = float(unique_patterns / len(cleaned_df)) if len(cleaned_df) else 0.0

    # Count how many distinct patterns belong to each class (0/1 for this binary target).
    pattern_stats["class_label"] = pattern_stats["mean"].round().astype(int)
    patterns_per_class = (
        pattern_stats["class_label"].value_counts().sort_index().astype(int).to_dict()
    )

    # Shuffling rows is generally not enough to solve this risk, but we still provide guidance.
    # The key issue is repeated patterns across splits, not row order itself.
    shuffle_needed = False

    # Human-readable notes to explain red flags.
    notes: List[str] = []
    if pattern_to_row_ratio < 0.30:
        notes.append(
            "Low unique-pattern ratio: many rows share identical feature vectors."
        )
    if conflicting_patterns == 0:
        notes.append(
            "No conflicting labels within identical patterns; mapping may be deterministic."
        )
    if max_pattern_frequency > max(10, int(0.10 * len(cleaned_df))):
        notes.append(
            "At least one feature pattern is heavily repeated; random split metrics may be optimistic."
        )
    if not notes:
        notes.append("No strong pattern-level leakage red flags detected.")

    return {
        "unique_feature_patterns": unique_patterns,
        "conflicting_patterns": conflicting_patterns,
        "max_pattern_frequency": max_pattern_frequency,
        "pattern_to_row_ratio": pattern_to_row_ratio,
        "patterns_per_class": patterns_per_class,
        "row_shuffle_needed_for_training": shuffle_needed,
        "notes": notes,
    }


def preprocess_dataset(
    df: pd.DataFrame,
    target_col: str,
    deduplicate_patterns: bool = False,
    max_pattern_frequency: int = 2,
    balance_tolerance: float = 0.05,
    noise_pct: float = 0.02,
    shuffle_random_state: int = 42,
) -> Tuple[pd.DataFrame, Dict]:
    """
    Execute end-to-end preprocessing and return cleaned dataframe + metadata report.

    Steps:
    1) Drop exact duplicate rows.
    2) Clean and validate target.
    3) Keep only prevention-time recommended features that exist in dataset.
    4) Remove constant selected columns (no learning value).
    5) Impute missing values for final features.
    """
    # Record original row count for traceability.
    input_rows = len(df)

    # Remove exact duplicates to avoid training bias from repeated rows.
    df = df.drop_duplicates().copy()
    rows_after_dedup = len(df)

    # Ensure requested target exists before any further processing.
    if target_col not in df.columns:
        raise ValueError(f"Target column '{target_col}' not found in dataset.")

    # Normalize target into binary 0/1 and drop invalid rows.
    df[target_col] = normalize_target_column(df[target_col])
    before_target_drop = len(df)
    df = df[df[target_col].notna()].copy()
    rows_after_target_clean = len(df)

    # Convert target to plain integer once invalid values are removed.
    df[target_col] = df[target_col].astype(int)

    # Engineer meaningful pre-deadlock feasibility and resource-pressure features.
    df, feature_engineering_info = engineer_prevention_features(df)

    # Align target direction with deadlock semantics (no process can proceed).
    df, target_alignment_info = align_deadlock_target_semantics(df, target_col)

    # Enforce strict deadlock definition: deadlock=1 iff no process can proceed now.
    logical_target = (pd.to_numeric(df["num_executable_processes"], errors="coerce").fillna(0.0) <= 0.0).astype(int)
    definition_mismatch_ratio = float((logical_target != df[target_col].astype(int)).mean())
    df[target_col] = logical_target

    # Keep requested base + engineered prevention-time features.
    selected_from_dataset = [
        col for col in FINAL_PREVENTION_FEATURES if col in df.columns
    ]

    # Track recommended columns not present in the dataset for transparency.
    missing_recommended_features = [
        col for col in FINAL_PREVENTION_FEATURES if col not in df.columns
    ]

    # Remove constant selected columns because they add no signal to training.
    constant_columns_removed: List[str] = [
        col for col in selected_from_dataset if df[col].nunique(dropna=False) <= 1
    ]

    # Final usable feature set after removing constants.
    final_used_features = [
        col for col in selected_from_dataset if col not in constant_columns_removed
    ]

    # Columns dropped due to strict "only selected prevention features" policy.
    columns_dropped_by_policy = [
        col for col in df.columns if col not in final_used_features + [target_col]
    ]

    # Capture leaky/unnecessary candidate columns that are present in this dataset.
    leaky_or_unnecessary_found = [
        col for col in LEAKY_OR_UNNECESSARY_CANDIDATES if col in df.columns
    ]

    # Count missing values before imputation only for final features.
    missing_before_imputation = (
        df[final_used_features].isna().sum().astype(int).to_dict()
        if final_used_features
        else {}
    )

    # Perform imputation and collect missing-value counts after imputation.
    missing_after_imputation = (
        impute_missing_values(df, final_used_features)
        if final_used_features
        else {}
    )

    # Build the final cleaned dataframe with model-ready columns + target.
    cleaned_df = df[final_used_features + [target_col]].copy()

    # Diversity diagnostics before diversity controls.
    duplicate_rows_before = (
        int(cleaned_df.duplicated(subset=final_used_features, keep="first").sum())
        if final_used_features
        else 0
    )
    duplicate_ratio_before = (
        float(duplicate_rows_before / len(cleaned_df))
        if len(cleaned_df) > 0
        else 0.0
    )
    unique_vectors_before = (
        int(cleaned_df[final_used_features].drop_duplicates().shape[0])
        if final_used_features
        else 0
    )

    # Backward compatible switch.
    effective_max_pattern_frequency = 1 if deduplicate_patterns else int(max_pattern_frequency)
    effective_max_pattern_frequency = max(1, effective_max_pattern_frequency)

    # Limit repeated patterns.
    cleaned_df, rows_removed_by_pattern_capping = cap_pattern_frequency(
        df=cleaned_df,
        feature_cols=final_used_features,
        max_pattern_frequency=effective_max_pattern_frequency,
        random_state=shuffle_random_state,
    )

    # Keep classes roughly balanced.
    cleaned_df, class_balance_info = enforce_class_balance(
        df=cleaned_df,
        target_col=target_col,
        balance_tolerance=balance_tolerance,
        random_state=shuffle_random_state,
    )

    # Optional small numeric noise on avg_* features if present.
    cleaned_df, noise_columns_applied = apply_controlled_noise(
        df=cleaned_df,
        noise_pct=noise_pct,
        random_state=shuffle_random_state,
    )

    # Final shuffle.
    cleaned_df = cleaned_df.sample(frac=1.0, random_state=shuffle_random_state).reset_index(drop=True)

    # Diversity diagnostics after diversity controls.
    duplicate_rows_after = (
        int(cleaned_df.duplicated(subset=final_used_features, keep="first").sum())
        if final_used_features
        else 0
    )
    duplicate_ratio_after = (
        float(duplicate_rows_after / len(cleaned_df))
        if len(cleaned_df) > 0
        else 0.0
    )
    unique_vectors_after = (
        int(cleaned_df[final_used_features].drop_duplicates().shape[0])
        if final_used_features
        else 0
    )

    # Keep a stable output column order.
    cleaned_df = cleaned_df[final_used_features + [target_col]]

    # Compute pattern-level diagnostics on the final training table.
    pattern_diagnostics = compute_pattern_diagnostics(
        cleaned_df=cleaned_df,
        feature_cols=final_used_features,
        target_col=target_col,
    )

    # Build a transparent report with all preprocessing decisions and counts.
    report: Dict = {
        "goal": "deadlock prevention (pre-outcome prediction)",
        "rows": {
            "input": input_rows,
            "after_dedup": rows_after_dedup,
            "after_target_cleaning": rows_after_target_clean,
            "after_pattern_dedup": len(cleaned_df),
        },
        "target": {
            "name": target_col,
            "distribution": cleaned_df[target_col].value_counts().sort_index().to_dict(),
            "rows_dropped_invalid_target": before_target_drop - rows_after_target_clean,
            "target_alignment": target_alignment_info,
            "strict_deadlock_definition_enforced": True,
            "original_vs_definition_mismatch_ratio": definition_mismatch_ratio,
        },
        "features": {
            "recommended_prevention_features": FINAL_PREVENTION_FEATURES,
            "high_risk_proxy_features_excluded": HIGH_RISK_PROXY_FEATURES,
            "selected_from_dataset": selected_from_dataset,
            "missing_recommended_features": missing_recommended_features,
            "final_used_features": final_used_features,
            "grouping_column": None,
            "constant_columns_removed": constant_columns_removed,
            "leaky_or_unnecessary_columns_found": leaky_or_unnecessary_found,
            "columns_dropped_by_not_selected_policy": columns_dropped_by_policy,
            "feature_engineering": feature_engineering_info,
        },
        "deduplication": {
            "pattern_dedup_enabled": deduplicate_patterns,
            "max_pattern_frequency": effective_max_pattern_frequency,
            "rows_removed_by_pattern_dedup": rows_removed_by_pattern_capping,
        },
        "diversity_diagnostics": {
            "unique_feature_vectors_before": unique_vectors_before,
            "unique_feature_vectors_after": unique_vectors_after,
            "duplicate_rows_before": duplicate_rows_before,
            "duplicate_rows_after": duplicate_rows_after,
            "duplicate_ratio_before": duplicate_ratio_before,
            "duplicate_ratio_after": duplicate_ratio_after,
            "class_balance": class_balance_info,
            "noise_pct": float(noise_pct),
            "noise_columns_applied": noise_columns_applied,
            "shuffle_random_state": int(shuffle_random_state),
        },
        "missing_values": {
            "before_imputation": {
                key: value for key, value in missing_before_imputation.items() if value > 0
            },
            "after_imputation": {
                key: value for key, value in missing_after_imputation.items() if value > 0
            },
        },
        "leakage_diagnostics": pattern_diagnostics,
    }

    return cleaned_df, report


def main() -> None:
    """Run preprocessing from CLI arguments and write outputs to disk."""
    # Parse runtime arguments.
    args = parse_args()

    # Ensure parent directories exist for output files.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)

    # Load source CSV.
    raw_df = pd.read_csv(args.input)

    # Preprocess and collect detailed report.
    cleaned_df, report = preprocess_dataset(
        raw_df,
        target_col=args.target,
        deduplicate_patterns=args.deduplicate_patterns,
        max_pattern_frequency=args.max_pattern_frequency,
        balance_tolerance=args.balance_tolerance,
        noise_pct=args.noise_pct,
        shuffle_random_state=args.shuffle_random_state,
    )

    # Write cleaned CSV for direct model training usage.
    cleaned_df.to_csv(args.output, index=False)

    # Write JSON report for traceability of preprocessing decisions.
    with args.report.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    # Print concise execution summary.
    print("Preprocessing complete")
    print(f"Input file:  {args.input}")
    print(f"Output file: {args.output}")
    print(f"Report file: {args.report}")
    print(f"Rows in output: {len(cleaned_df)}")
    print(f"Final features: {report['features']['final_used_features']}")
    print(
        "Unique feature vectors (before -> after): "
        f"{report['diversity_diagnostics']['unique_feature_vectors_before']} -> "
        f"{report['diversity_diagnostics']['unique_feature_vectors_after']}"
    )
    print(
        "Duplicate ratio (before -> after): "
        f"{report['diversity_diagnostics']['duplicate_ratio_before']:.4f} -> "
        f"{report['diversity_diagnostics']['duplicate_ratio_after']:.4f}"
    )
    print(
        "Class distribution after balancing: "
        f"{report['diversity_diagnostics']['class_balance']['after']}"
    )


# Standard script entry point.
if __name__ == "__main__":
    main()
