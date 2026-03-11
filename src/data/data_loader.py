"""
Data loader module for Korzinka inventory forecasting.
Handles loading and basic validation of the Kaggle store-item demand dataset.
"""

import logging
import pandas as pd
import numpy as np
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

RAW_DIR = Path(__file__).parents[2] / "data" / "raw"
PROCESSED_DIR = Path(__file__).parents[2] / "data" / "processed"


def load_train(path: str | Path | None = None) -> pd.DataFrame:
    """
    Load training data (2013-01-01 to 2017-12-31).

    Returns
    -------
    pd.DataFrame with columns: date (datetime), store, item, sales
    """
    path = Path(path) if path else RAW_DIR / "train.csv"
    logger.info(f"Loading training data from {path}")
    df = pd.read_csv(path, parse_dates=["date"])
    _validate(df, expected_cols={"date", "store", "item", "sales"})
    logger.info(f"Loaded {len(df):,} rows | {df['date'].min()} → {df['date'].max()}")
    return df


def load_test(path: str | Path | None = None) -> pd.DataFrame:
    """
    Load test data (2018-01-01 to 2018-03-31).

    Returns
    -------
    pd.DataFrame with columns: id, date (datetime), store, item
    """
    path = Path(path) if path else RAW_DIR / "test.csv"
    logger.info(f"Loading test data from {path}")
    df = pd.read_csv(path, parse_dates=["date"])
    _validate(df, expected_cols={"id", "date", "store", "item"})
    logger.info(f"Loaded {len(df):,} test rows | {df['date'].min()} → {df['date'].max()}")
    return df


def load_sample(n_stores: int = 2, n_items: int = 5, random_state: int = 42) -> pd.DataFrame:
    """
    Load a small subset of training data for fast prototyping.

    Parameters
    ----------
    n_stores : number of stores to include
    n_items  : number of items to include
    """
    df = load_train()
    rng = np.random.default_rng(random_state)
    stores = rng.choice(df["store"].unique(), size=min(n_stores, 10), replace=False)
    items = rng.choice(df["item"].unique(), size=min(n_items, 50), replace=False)
    sample = df[df["store"].isin(stores) & df["item"].isin(items)].copy()
    logger.info(f"Sample: {len(sample):,} rows | {n_stores} stores × {n_items} items")
    return sample


def dataset_summary(df: pd.DataFrame) -> dict:
    """Return a summary dict of the dataset."""
    return {
        "rows": len(df),
        "date_range": (df["date"].min().strftime("%Y-%m-%d"), df["date"].max().strftime("%Y-%m-%d")),
        "stores": sorted(df["store"].unique().tolist()),
        "n_stores": df["store"].nunique(),
        "n_items": df["item"].nunique(),
        "missing_values": df.isnull().sum().to_dict(),
        "sales_stats": df["sales"].describe().to_dict() if "sales" in df.columns else {},
    }


def _validate(df: pd.DataFrame, expected_cols: set) -> None:
    missing = expected_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns: {missing}")
    if df.isnull().values.any():
        logger.warning("Dataset contains missing values — run preprocessor to handle them")
