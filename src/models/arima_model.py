"""
ARIMA model for demand forecasting.
Fits one ARIMA per store-item pair using auto_arima for parameter selection.
Best suited for Fresh Produce and seasonal time series.
"""

import logging
import warnings
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from tqdm import tqdm

logger = logging.getLogger(__name__)
warnings.filterwarnings("ignore")

MODELS_DIR = Path(__file__).parents[2] / "models"


class ARIMAForecaster:
    """
    Wrapper that fits one ARIMA model per (store, item) pair.

    Usage
    -----
    forecaster = ARIMAForecaster()
    forecaster.fit(train_df)                   # fits all store-item models
    preds = forecaster.predict_all(n_periods=90)  # 90-day forecast
    """

    def __init__(
        self,
        seasonal: bool = True,
        m: int = 7,          # weekly seasonality
        max_p: int = 3,
        max_q: int = 3,
        max_P: int = 1,
        max_Q: int = 1,
        information_criterion: str = "aic",
        random_state: int = 42,
    ):
        self.seasonal = seasonal
        self.m = m
        self.max_p = max_p
        self.max_q = max_q
        self.max_P = max_P
        self.max_Q = max_Q
        self.information_criterion = information_criterion
        self.random_state = random_state
        self.models: dict[tuple, object] = {}   # (store, item) → fitted model
        self.is_fitted = False

    def fit(self, df: pd.DataFrame) -> "ARIMAForecaster":
        """
        Fit ARIMA for each unique (store, item) pair.

        Parameters
        ----------
        df : DataFrame with columns [date, store, item, sales]
        """
        try:
            from pmdarima import auto_arima
        except ImportError:
            raise ImportError("pmdarima is required. Run: pip install pmdarima")

        groups = list(df.groupby(["store", "item"]))
        logger.info(f"Fitting ARIMA for {len(groups)} store-item pairs...")

        for (store, item), group in tqdm(groups, desc="ARIMA fitting"):
            series = group.sort_values("date").set_index("date")["sales"]
            try:
                model = auto_arima(
                    series,
                    seasonal=self.seasonal,
                    m=self.m,
                    max_p=self.max_p,
                    max_q=self.max_q,
                    max_P=self.max_P,
                    max_Q=self.max_Q,
                    information_criterion=self.information_criterion,
                    suppress_warnings=True,
                    error_action="ignore",
                    stepwise=True,
                )
                self.models[(store, item)] = model
            except Exception as e:
                logger.warning(f"ARIMA failed for store={store}, item={item}: {e}")

        self.is_fitted = True
        logger.info(f"Fitted {len(self.models)} ARIMA models successfully")
        return self

    def predict(self, store: int, item: int, n_periods: int = 90) -> np.ndarray:
        """Forecast n_periods ahead for a specific store-item pair."""
        key = (store, item)
        if key not in self.models:
            raise KeyError(f"No fitted model for store={store}, item={item}")
        forecast = self.models[key].predict(n_periods=n_periods)
        return np.clip(forecast, 0, None)

    def predict_all(
        self,
        n_periods: int = 90,
        start_date: str = "2018-01-01",
    ) -> pd.DataFrame:
        """
        Generate forecasts for all fitted store-item pairs.

        Returns
        -------
        pd.DataFrame with columns: date, store, item, sales_forecast
        """
        if not self.is_fitted:
            raise RuntimeError("Call fit() first.")

        records = []
        future_dates = pd.date_range(start=start_date, periods=n_periods, freq="D")

        for (store, item), model in self.models.items():
            forecast = np.clip(model.predict(n_periods=n_periods), 0, None)
            for date, val in zip(future_dates, forecast):
                records.append({"date": date, "store": store, "item": item, "sales_forecast": val})

        return pd.DataFrame(records)

    def in_sample_predictions(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate in-sample predictions for validation (uses predict_in_sample).

        Returns DataFrame aligned with input df for metric calculation.
        """
        results = []
        for (store, item), group in df.groupby(["store", "item"]):
            key = (store, item)
            if key not in self.models:
                continue
            series = group.sort_values("date").set_index("date")["sales"]
            try:
                preds = self.models[key].predict_in_sample()
                sub = group.sort_values("date").copy()
                sub["sales_pred"] = np.clip(preds, 0, None)
                results.append(sub)
            except Exception as e:
                logger.warning(f"In-sample prediction failed for {key}: {e}")

        return pd.concat(results, ignore_index=True) if results else pd.DataFrame()

    def save(self, filename: str = "arima_models.pkl") -> Path:
        """Save all fitted models to disk."""
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = MODELS_DIR / filename
        joblib.dump(self, out_path)
        logger.info(f"ARIMA models saved → {out_path}")
        return out_path

    @classmethod
    def load(cls, filename: str = "arima_models.pkl") -> "ARIMAForecaster":
        path = MODELS_DIR / filename
        forecaster = joblib.load(path)
        logger.info(f"ARIMA models loaded from {path}")
        return forecaster
