"""
Visualization utilities for inventory forecasting analysis.
"""

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import seaborn as sns
import pandas as pd
import numpy as np
from typing import Optional

sns.set_theme(style="whitegrid", palette="muted")
FIGSIZE_WIDE = (14, 5)
FIGSIZE_SQ = (10, 7)


def plot_sales_over_time(
    df: pd.DataFrame,
    store: int,
    item: int,
    ax: Optional[plt.Axes] = None,
) -> plt.Figure:
    """Plot daily sales for a specific store-item pair."""
    subset = df[(df["store"] == store) & (df["item"] == item)].sort_values("date")
    fig, ax = plt.subplots(figsize=FIGSIZE_WIDE) if ax is None else (ax.get_figure(), ax)
    ax.plot(subset["date"], subset["sales"], linewidth=0.8, color="steelblue")
    ax.set_title(f"Daily Sales — Store {store}, Item {item}")
    ax.set_xlabel("Date")
    ax.set_ylabel("Units Sold")
    ax.xaxis.set_major_locator(mdates.YearLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
    fig.tight_layout()
    return fig


def plot_seasonal_decomposition(df: pd.DataFrame, store: int, item: int) -> plt.Figure:
    """Plot monthly average sales to reveal seasonality."""
    subset = df[(df["store"] == store) & (df["item"] == item)].copy()
    subset["month"] = subset["date"].dt.month
    monthly = subset.groupby("month")["sales"].mean()

    fig, ax = plt.subplots(figsize=(10, 4))
    monthly.plot(kind="bar", ax=ax, color="steelblue", edgecolor="white")
    ax.set_title(f"Average Monthly Sales — Store {store}, Item {item}")
    ax.set_xlabel("Month")
    ax.set_ylabel("Avg Units Sold")
    ax.set_xticklabels(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        rotation=45,
    )
    fig.tight_layout()
    return fig


def plot_day_of_week_pattern(df: pd.DataFrame) -> plt.Figure:
    """Plot average sales by day of week across all store-item pairs."""
    df = df.copy()
    df["dow"] = df["date"].dt.dayofweek
    dow_avg = df.groupby("dow")["sales"].mean()

    fig, ax = plt.subplots(figsize=(8, 4))
    dow_avg.plot(kind="bar", ax=ax, color="coral", edgecolor="white")
    ax.set_title("Average Sales by Day of Week")
    ax.set_xlabel("Day")
    ax.set_ylabel("Avg Units Sold")
    ax.set_xticklabels(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], rotation=0)
    fig.tight_layout()
    return fig


def plot_store_item_heatmap(df: pd.DataFrame) -> plt.Figure:
    """Heatmap of average sales per store-item combination."""
    pivot = df.groupby(["store", "item"])["sales"].mean().unstack("item")
    fig, ax = plt.subplots(figsize=(16, 6))
    sns.heatmap(pivot, ax=ax, cmap="YlOrRd", linewidths=0.1, cbar_kws={"label": "Avg Sales"})
    ax.set_title("Average Sales Heatmap (Store × Item)")
    ax.set_xlabel("Item")
    ax.set_ylabel("Store")
    fig.tight_layout()
    return fig


def plot_forecast_vs_actual(
    dates: pd.Series,
    y_true: np.ndarray,
    y_pred: np.ndarray,
    model_name: str = "Model",
    ax: Optional[plt.Axes] = None,
) -> plt.Figure:
    """Plot actual vs predicted sales."""
    fig, ax = plt.subplots(figsize=FIGSIZE_WIDE) if ax is None else (ax.get_figure(), ax)
    ax.plot(dates, y_true, label="Actual", color="steelblue", linewidth=1.2)
    ax.plot(dates, y_pred, label=f"Predicted ({model_name})", color="coral",
            linewidth=1.2, linestyle="--")
    ax.fill_between(dates, y_true, y_pred, alpha=0.15, color="grey")
    ax.set_title(f"Actual vs Predicted — {model_name}")
    ax.set_xlabel("Date")
    ax.set_ylabel("Units Sold")
    ax.legend()
    fig.tight_layout()
    return fig


def plot_model_comparison(comparison_df: pd.DataFrame) -> plt.Figure:
    """Bar chart comparing MAPE, RMSE, MAE across models."""
    metrics = ["mape", "rmse", "mae"]
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    colors = ["steelblue", "coral", "mediumseagreen"]
    for ax, metric, color in zip(axes, metrics, colors):
        comparison_df[metric].plot(kind="bar", ax=ax, color=color, edgecolor="white")
        ax.set_title(metric.upper())
        ax.set_ylabel("Value")
        ax.set_xlabel("")
        ax.tick_params(axis="x", rotation=30)
    fig.suptitle("Model Performance Comparison", fontsize=14, fontweight="bold")
    fig.tight_layout()
    return fig


def plot_feature_importance(feature_names: list[str], importances: np.ndarray) -> plt.Figure:
    """Horizontal bar chart of Random Forest feature importances."""
    idx = np.argsort(importances)
    fig, ax = plt.subplots(figsize=(9, max(4, len(feature_names) * 0.3)))
    ax.barh(np.array(feature_names)[idx], importances[idx], color="steelblue")
    ax.set_title("Feature Importance (Random Forest)")
    ax.set_xlabel("Importance")
    fig.tight_layout()
    return fig


def plot_residuals(y_true: np.ndarray, y_pred: np.ndarray, model_name: str = "Model") -> plt.Figure:
    """Residual distribution plot."""
    residuals = y_true - y_pred
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    axes[0].scatter(y_pred, residuals, alpha=0.3, s=8, color="steelblue")
    axes[0].axhline(0, color="red", linestyle="--", linewidth=1)
    axes[0].set_title(f"Residuals vs Predicted — {model_name}")
    axes[0].set_xlabel("Predicted")
    axes[0].set_ylabel("Residual")

    axes[1].hist(residuals, bins=50, color="steelblue", edgecolor="white")
    axes[1].set_title("Residual Distribution")
    axes[1].set_xlabel("Residual")
    fig.tight_layout()
    return fig
