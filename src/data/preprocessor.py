"""
Preprocessor module: feature engineering for store-item demand forecasting.
Creates time-based, lag, and rolling features from raw sales data.
"""

import logging
import pandas as pd
import numpy as np
from pathlib import Path

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Time features
# ---------------------------------------------------------------------------

def add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add calendar-based features derived from the date column."""
    df = df.copy()
    df["year"] = df["date"].dt.year
    df["month"] = df["date"].dt.month
    df["day"] = df["date"].dt.day
    df["day_of_week"] = df["date"].dt.dayofweek          # 0=Mon, 6=Sun
    df["day_of_year"] = df["date"].dt.dayofyear
    df["week_of_year"] = df["date"].dt.isocalendar().week.astype(int)
    df["quarter"] = df["date"].dt.quarter
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
    df["is_month_start"] = df["date"].dt.is_month_start.astype(int)
    df["is_month_end"] = df["date"].dt.is_month_end.astype(int)

    # Uzbekistan-aligned seasons (approximate)
    df["season"] = df["month"].map({
        12: "winter", 1: "winter", 2: "winter",
        3: "spring",  4: "spring", 5: "spring",
        6: "summer",  7: "summer", 8: "summer",
        9: "autumn",  10: "autumn", 11: "autumn",
    })
    # Encode season as integer for ML models
    season_map = {"winter": 0, "spring": 1, "summer": 2, "autumn": 3}
    df["season_code"] = df["season"].map(season_map)

    return df


# ---------------------------------------------------------------------------
# Lag & rolling features
# ---------------------------------------------------------------------------

def add_lag_features(
    df: pd.DataFrame,
    lags: list[int] = [7, 14, 30],
    group_cols: list[str] = ["store", "item"],
) -> pd.DataFrame:
    """
    Add lag sales features per store-item group.

    Parameters
    ----------
    lags : list of integer lag days
    group_cols : columns that define a unique time series
    """
    df = df.sort_values(["store", "item", "date"]).copy()
    for lag in lags:
        col = f"sales_lag_{lag}"
        df[col] = df.groupby(group_cols)["sales"].shift(lag)
        logger.debug(f"Added {col}")
    return df


def add_rolling_features(
    df: pd.DataFrame,
    windows: list[int] = [7, 14, 30],
    group_cols: list[str] = ["store", "item"],
) -> pd.DataFrame:
    """
    Add rolling mean and std features per store-item group.

    Parameters
    ----------
    windows : rolling window sizes in days
    group_cols : columns that define a unique time series
    """
    df = df.sort_values(["store", "item", "date"]).copy()
    for w in windows:
        rolled = df.groupby(group_cols)["sales"].transform(
            lambda x: x.shift(1).rolling(w, min_periods=1).mean()
        )
        df[f"rolling_mean_{w}"] = rolled

        rolled_std = df.groupby(group_cols)["sales"].transform(
            lambda x: x.shift(1).rolling(w, min_periods=1).std()
        )
        df[f"rolling_std_{w}"] = rolled_std.fillna(0)

    return df


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------

def build_features(
    df: pd.DataFrame,
    lags: list[int] = [7, 14, 30],
    rolling_windows: list[int] = [7, 14, 30],
    drop_na: bool = True,
) -> pd.DataFrame:
    """
    Full feature engineering pipeline.

    Parameters
    ----------
    df          : raw sales DataFrame with columns [date, store, item, sales]
    lags        : lag feature days
    rolling_windows : rolling window sizes
    drop_na     : whether to drop rows with NaN lag/rolling values
    """
    logger.info("Building features...")
    df = add_time_features(df)
    df = add_lag_features(df, lags=lags)
    df = add_rolling_features(df, windows=rolling_windows)

    if drop_na:
        before = len(df)
        df = df.dropna()
        logger.info(f"Dropped {before - len(df):,} rows with NaN (lag/rolling warmup)")

    logger.info(f"Feature matrix: {df.shape} | columns: {list(df.columns)}")
    return df


def get_feature_columns(df: pd.DataFrame) -> list[str]:
    """Return the ML feature column names (excludes identifiers and target)."""
    exclude = {"date", "sales", "season", "id"}
    return [c for c in df.columns if c not in exclude]


def train_test_split_temporal(
    df: pd.DataFrame,
    test_months: int = 3,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Temporal train/validation split — last N months as validation.

    Parameters
    ----------
    test_months : number of months to hold out for validation
    """
    cutoff = df["date"].max() - pd.DateOffset(months=test_months)
    train = df[df["date"] <= cutoff].copy()
    val = df[df["date"] > cutoff].copy()
    logger.info(f"Train: {len(train):,} rows up to {cutoff.date()}")
    logger.info(f"Val:   {len(val):,} rows after {cutoff.date()}")
    return train, val


def save_processed(df: pd.DataFrame, filename: str) -> Path:
    """Save processed DataFrame to the processed data directory."""
    out_dir = Path(__file__).parents[2] / "data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / filename
    df.to_csv(out_path, index=False)
    logger.info(f"Saved processed data → {out_path}")
    return out_path
