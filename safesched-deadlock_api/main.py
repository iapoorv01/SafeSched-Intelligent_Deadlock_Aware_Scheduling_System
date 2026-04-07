"""
FastAPI inference server for SafeSched deadlock prediction.

Input schema follows matrix-based system state and is transformed into the
same feature order used by the trained Logistic Regression pipeline.
"""

from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


ROOT_DIR = Path(__file__).resolve().parent
MODEL_PATH = ROOT_DIR / "models" / "logistic_regression_deadlock.joblib"
DEFAULT_THRESHOLD = 0.02


class PredictRequest(BaseModel):
    processes: int
    resources: int
    allocation_matrix: List[List[int]]
    max_matrix: List[List[int]]
    available: List[int]


class PredictResponse(BaseModel):
    deadlock: int
    confidence: float


app = FastAPI(title="SafeSched Deadlock Prediction API", version="1.0.0")

MODEL_PIPELINE: Any = None
FEATURE_COLUMNS: List[str] = []
PREDICTION_THRESHOLD: float = DEFAULT_THRESHOLD


def compute_deadlock_from_state(payload: PredictRequest) -> Dict[str, Any]:
    """
    Determine deadlock using a matrix safety-progress check.

    A process can complete if NEED <= current work vector.
    Processes holding no resources are treated as not participating in deadlock.
    """
    p = payload.processes
    r = payload.resources

    allocation = [row[:] for row in payload.allocation_matrix]
    maximum = [row[:] for row in payload.max_matrix]
    work = payload.available[:]

    need = [
        [maximum[i][j] - allocation[i][j] for j in range(r)]
        for i in range(p)
    ]

    immediate_runnable = sum(
        1
        for i in range(p)
        if all(need[i][j] <= work[j] for j in range(r))
    )

    # Deadlock detection loop using progress over finish flags.
    finish = [all(allocation[i][j] == 0 for j in range(r)) for i in range(p)]
    made_progress = True
    while made_progress:
        made_progress = False
        for i in range(p):
            if finish[i]:
                continue
            if all(need[i][j] <= work[j] for j in range(r)):
                for j in range(r):
                    work[j] += allocation[i][j]
                finish[i] = True
                made_progress = True

    deadlocked_processes = [i for i in range(p) if not finish[i]]
    logical_deadlock = int(len(deadlocked_processes) > 0)

    return {
        "logical_deadlock": logical_deadlock,
        "deadlocked_processes": deadlocked_processes,
        "immediate_runnable_processes": int(immediate_runnable),
    }


def load_model_artifact(path: Path) -> Tuple[Any, List[str], float]:
    """Load trained artifact once at startup."""
    if not path.exists():
        raise FileNotFoundError(f"Model artifact not found: {path}")

    artifact = joblib.load(path)

    if isinstance(artifact, dict) and "pipeline" in artifact:
        pipeline = artifact["pipeline"]
        feature_columns = list(artifact.get("feature_columns", []))
        threshold = float(artifact.get("decision_threshold", DEFAULT_THRESHOLD))
        return pipeline, feature_columns, threshold

    if hasattr(artifact, "predict"):
        return artifact, [], DEFAULT_THRESHOLD

    raise ValueError("Unsupported model artifact format.")


def validate_state(payload: PredictRequest) -> None:
    """Validate matrix sizes and value constraints with clear messages."""
    p = payload.processes
    r = payload.resources

    if p <= 0:
        raise HTTPException(status_code=400, detail="'processes' must be > 0.")
    if r <= 0:
        raise HTTPException(status_code=400, detail="'resources' must be > 0.")

    if len(payload.allocation_matrix) != p:
        raise HTTPException(
            status_code=400,
            detail=f"allocation_matrix row count must equal processes ({p}).",
        )
    if len(payload.max_matrix) != p:
        raise HTTPException(
            status_code=400,
            detail=f"max_matrix row count must equal processes ({p}).",
        )
    if len(payload.available) != r:
        raise HTTPException(
            status_code=400,
            detail=f"available length must equal resources ({r}).",
        )

    for i, row in enumerate(payload.allocation_matrix):
        if len(row) != r:
            raise HTTPException(
                status_code=400,
                detail=f"allocation_matrix row {i} must have {r} columns.",
            )
    for i, row in enumerate(payload.max_matrix):
        if len(row) != r:
            raise HTTPException(
                status_code=400,
                detail=f"max_matrix row {i} must have {r} columns.",
            )

    for i in range(p):
        for j in range(r):
            alloc = payload.allocation_matrix[i][j]
            mx = payload.max_matrix[i][j]
            if alloc < 0 or mx < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Negative values are not allowed (process={i}, resource={j}).",
                )
            if alloc > mx:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"allocation cannot exceed max at process={i}, resource={j} "
                        f"(allocation={alloc}, max={mx})."
                    ),
                )

    if any(v < 0 for v in payload.available):
        raise HTTPException(status_code=400, detail="'available' cannot contain negative values.")


def build_engineered_features(payload: PredictRequest) -> Dict[str, float]:
    """Create derived system-state features from matrices."""
    p = payload.processes
    r = payload.resources

    total_allocation = float(sum(sum(row) for row in payload.allocation_matrix))
    total_max = float(sum(sum(row) for row in payload.max_matrix))
    total_need = float(max(total_max - total_allocation, 0.0))
    total_available = float(sum(payload.available))

    num_executable_processes = int(
        sum(
            1
            for i in range(p)
            if all(
                payload.max_matrix[i][j] - payload.allocation_matrix[i][j] <= payload.available[j]
                for j in range(r)
            )
        )
    )
    blocked_processes = int(max(p - num_executable_processes, 0))

    total_resources = float(total_allocation + total_available)
    fraction_blocked = float(blocked_processes / p) if p > 0 else 0.0
    utilization_ratio = float(total_allocation / total_resources) if total_resources > 0 else 0.0
    need_to_available_ratio = (
        float(total_need / total_available) if total_available > 0 else float(total_need)
    )

    return {
        "num_processes": float(p),
        "num_resources": float(r),
        "distributed": 0.0,
        "dynamic_join_leave": 0.0,
        "total_allocation": total_allocation,
        "total_max": total_max,
        "total_need": total_need,
        "total_available": total_available,
        "num_executable_processes": float(num_executable_processes),
        "blocked_processes": float(blocked_processes),
        "fraction_blocked": fraction_blocked,
        "utilization_ratio": utilization_ratio,
        "need_to_available_ratio": need_to_available_ratio,
        # Backward-compatible aliases if older artifacts expect these names.
        "total_resources": total_resources,
        "sum_available": total_available,
        "unmet_need_processes": float(blocked_processes),
        "feasible_processes_now": float(num_executable_processes),
        "unmet_demand_vs_supply": float(max(total_need - total_available, 0.0)),
        "resource_utilization_ratio": utilization_ratio,
    }


def to_model_frame(engineered: Dict[str, float]) -> pd.DataFrame:
    """Project engineered features into exact training feature order."""
    if FEATURE_COLUMNS:
        row = {col: engineered.get(col, 0.0) for col in FEATURE_COLUMNS}
        return pd.DataFrame([row], columns=FEATURE_COLUMNS)
    return pd.DataFrame([engineered])


@app.on_event("startup")
def startup_load_model() -> None:
    """Load model once for all requests."""
    global MODEL_PIPELINE, FEATURE_COLUMNS, PREDICTION_THRESHOLD
    MODEL_PIPELINE, FEATURE_COLUMNS, PREDICTION_THRESHOLD = load_model_artifact(MODEL_PATH)


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "model_loaded": MODEL_PIPELINE is not None,
        "model_path": str(MODEL_PATH),
        "feature_columns": FEATURE_COLUMNS,
        "threshold": PREDICTION_THRESHOLD,
    }


@app.post("/predict", response_model=PredictResponse)
def predict(payload: PredictRequest) -> PredictResponse:
    """Predict deadlock from matrix state payload."""
    if MODEL_PIPELINE is None:
        raise HTTPException(status_code=500, detail="Model not loaded.")

    validate_state(payload)
    engineered = build_engineered_features(payload)
    model_input = to_model_frame(engineered)

    try:
        if hasattr(MODEL_PIPELINE, "predict_proba"):
            deadlock_probability = float(MODEL_PIPELINE.predict_proba(model_input)[0][1])
            deadlock = int(deadlock_probability >= PREDICTION_THRESHOLD)
            confidence = deadlock_probability if deadlock == 1 else (1.0 - deadlock_probability)
        elif hasattr(MODEL_PIPELINE, "predict"):
            deadlock = int(MODEL_PIPELINE.predict(model_input)[0])
            confidence = float(deadlock)
        else:
            raise HTTPException(status_code=500, detail="Loaded model does not support prediction.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Prediction failed: {exc}") from exc

    return PredictResponse(deadlock=deadlock, confidence=confidence)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
