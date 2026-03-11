"""
Evaluation metrics for demand forecasting models.
"""

import numpy as np
import pandas as pd
from typing import Union

ArrayLike = Union[np.ndarray, pd.Series, list]


def mape(y_true: ArrayLike, y_pred: ArrayLike, epsilon: float = 1e-8) -> float:
    """
    Mean Absolute Percentage Error.
    Clips denominator to avoid division by zero.
    """
    y_true = np.array(y_true, dtype=float)
    y_pred = np.array(y_pred, dtype=float)
    return float(np.mean(np.abs((y_true - y_pred) / np.maximum(np.abs(y_true), epsilon))) * 100)


def smape(y_true: ArrayLike, y_pred: ArrayLike, epsilon: float = 1e-8) -> float:
    """
    Symmetric Mean Absolute Percentage Error.
    More robust than MAPE for near-zero actuals.
    """
    y_true = np.array(y_true, dtype=float)
    y_pred = np.array(y_pred, dtype=float)
    denom = (np.abs(y_true) + np.abs(y_pred)) / 2 + epsilon
    return float(np.mean(np.abs(y_true - y_pred) / denom) * 100)


def mae(y_true: ArrayLike, y_pred: ArrayLike) -> float:
    """Mean Absolute Error."""
    y_true = np.array(y_true, dtype=float)
    y_pred = np.array(y_pred, dtype=float)
    return float(np.mean(np.abs(y_true - y_pred)))


def rmse(y_true: ArrayLike, y_pred: ArrayLike) -> float:
    """Root Mean Squared Error."""
    y_true = np.array(y_true, dtype=float)
    y_pred = np.array(y_pred, dtype=float)
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def r2(y_true: ArrayLike, y_pred: ArrayLike) -> float:
    """Coefficient of Determination (R²)."""
    y_true = np.array(y_true, dtype=float)
    y_pred = np.array(y_pred, dtype=float)
    ss_res = np.sum((y_true - y_pred) ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    return float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0


def evaluate_all(y_true: ArrayLike, y_pred: ArrayLike, model_name: str = "Model") -> dict:
    """
    Compute all metrics and return as a dict.

    Returns
    -------
    dict with keys: model, mape, smape, mae, rmse, r2
    """
    return {
        "model": model_name,
        "mape": round(mape(y_true, y_pred), 4),
        "smape": round(smape(y_true, y_pred), 4),
        "mae": round(mae(y_true, y_pred), 4),
        "rmse": round(rmse(y_true, y_pred), 4),
        "r2": round(r2(y_true, y_pred), 4),
    }


def compare_models(results: list[dict]) -> pd.DataFrame:
    """
    Build a comparison DataFrame from a list of evaluate_all() outputs.

    Parameters
    ----------
    results : list of dicts returned by evaluate_all()
    """
    df = pd.DataFrame(results).set_index("model")
    df = df.sort_values("mape")
    return df
