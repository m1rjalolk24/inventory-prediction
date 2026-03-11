"""
Random Forest model for demand forecasting.
Best overall model — handles complex feature interactions and non-linearity.
"""

import logging
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import RandomizedSearchCV

logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).parents[2] / "models"


class RandomForestForecaster:
    """
    Random Forest demand forecasting model.

    Trains a single global model across all store-item pairs,
    using store and item as encoded features alongside time/lag features.

    Usage
    -----
    model = RandomForestForecaster()
    model.fit(X_train, y_train)
    preds = model.predict(X_test)
    model.save()
    """

    def __init__(
        self,
        n_estimators: int = 300,
        max_depth: int = 15,
        min_samples_leaf: int = 4,
        max_features: float = 0.6,
        n_jobs: int = -1,
        random_state: int = 42,
    ):
        self.rf = RandomForestRegressor(
            n_estimators=n_estimators,
            max_depth=max_depth,
            min_samples_leaf=min_samples_leaf,
            max_features=max_features,
            n_jobs=n_jobs,
            random_state=random_state,
        )
        self.feature_cols: list[str] = []
        self.is_fitted = False

    def fit(self, X_train: pd.DataFrame, y_train: pd.Series) -> "RandomForestForecaster":
        """Fit the Random Forest on training features."""
        self.feature_cols = list(X_train.columns)
        logger.info(
            f"Fitting RandomForest on {len(X_train):,} samples, "
            f"{len(self.feature_cols)} features, "
            f"{self.rf.n_estimators} trees"
        )
        self.rf.fit(X_train, y_train)
        self.is_fitted = True

        train_pred = self.rf.predict(X_train)
        train_rmse = np.sqrt(np.mean((y_train.values - train_pred) ** 2))
        logger.info(f"Train RMSE: {train_rmse:.4f}")
        return self

    def tune(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        n_iter: int = 20,
        cv: int = 3,
    ) -> "RandomForestForecaster":
        """
        Hyperparameter search using RandomizedSearchCV.

        Parameters
        ----------
        n_iter : number of random parameter combinations to try
        cv     : number of cross-validation folds
        """
        param_dist = {
            "n_estimators": [100, 200, 300, 500],
            "max_depth": [8, 12, 15, 20, None],
            "min_samples_leaf": [2, 4, 6, 10],
            "max_features": [0.4, 0.6, 0.8, "sqrt"],
        }
        logger.info("Starting hyperparameter search...")
        search = RandomizedSearchCV(
            self.rf,
            param_dist,
            n_iter=n_iter,
            cv=cv,
            scoring="neg_root_mean_squared_error",
            n_jobs=-1,
            random_state=42,
            verbose=1,
        )
        search.fit(X_train, y_train)
        self.rf = search.best_estimator_
        logger.info(f"Best params: {search.best_params_}")
        logger.info(f"Best CV RMSE: {-search.best_score_:.4f}")
        self.feature_cols = list(X_train.columns)
        self.is_fitted = True
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Generate non-negative predictions."""
        if not self.is_fitted:
            raise RuntimeError("Model is not fitted. Call fit() first.")
        preds = self.rf.predict(X[self.feature_cols])
        return np.clip(preds, 0, None)

    @property
    def feature_importance(self) -> pd.Series:
        """Feature importances sorted descending."""
        return (
            pd.Series(self.rf.feature_importances_, index=self.feature_cols)
            .sort_values(ascending=False)
        )

    def save(self, filename: str = "random_forest.pkl") -> Path:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = MODELS_DIR / filename
        joblib.dump(self, out_path)
        logger.info(f"Model saved → {out_path}")
        return out_path

    @classmethod
    def load(cls, filename: str = "random_forest.pkl") -> "RandomForestForecaster":
        path = MODELS_DIR / filename
        model = joblib.load(path)
        logger.info(f"Model loaded from {path}")
        return model
