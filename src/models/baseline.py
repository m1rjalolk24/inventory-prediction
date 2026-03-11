"""
Baseline Linear Regression model for demand forecasting.
Used as performance benchmark against ARIMA and Random Forest.
"""

import logging
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).parents[2] / "models"


class BaselineModel:
    """
    Linear Regression baseline using calendar and lag features.

    Usage
    -----
    model = BaselineModel()
    model.fit(X_train, y_train)
    preds = model.predict(X_test)
    model.save("baseline_lr.pkl")
    """

    def __init__(self, random_state: int = 42):
        self.random_state = random_state
        self.pipeline = Pipeline([
            ("scaler", StandardScaler()),
            ("lr", LinearRegression()),
        ])
        self.feature_cols: list[str] = []
        self.is_fitted = False

    def fit(self, X_train: pd.DataFrame, y_train: pd.Series) -> "BaselineModel":
        """Fit the pipeline on training features."""
        self.feature_cols = list(X_train.columns)
        logger.info(f"Fitting LinearRegression on {len(X_train):,} samples, {len(self.feature_cols)} features")
        self.pipeline.fit(X_train, y_train)
        self.is_fitted = True
        train_pred = self.pipeline.predict(X_train)
        train_rmse = np.sqrt(np.mean((y_train.values - train_pred) ** 2))
        logger.info(f"Train RMSE: {train_rmse:.4f}")
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Generate predictions (clipped to non-negative)."""
        if not self.is_fitted:
            raise RuntimeError("Model is not fitted. Call fit() first.")
        preds = self.pipeline.predict(X[self.feature_cols])
        return np.clip(preds, 0, None)

    def save(self, filename: str = "baseline_lr.pkl") -> Path:
        """Persist model to disk."""
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = MODELS_DIR / filename
        joblib.dump(self, out_path)
        logger.info(f"Model saved → {out_path}")
        return out_path

    @classmethod
    def load(cls, filename: str = "baseline_lr.pkl") -> "BaselineModel":
        """Load a saved model from disk."""
        path = MODELS_DIR / filename
        model = joblib.load(path)
        logger.info(f"Model loaded from {path}")
        return model

    @property
    def coefficients(self) -> pd.Series:
        """Return feature coefficients as a named Series."""
        lr = self.pipeline.named_steps["lr"]
        return pd.Series(lr.coef_, index=self.feature_cols).sort_values(key=abs, ascending=False)
