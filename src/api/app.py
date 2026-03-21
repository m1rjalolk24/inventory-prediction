"""
Flask API for Korzinka Inventory Forecasting System.

Endpoints:
  GET    /health                      - Health check
  GET    /api/v1/stores               - List available stores
  GET    /api/v1/items                - List available items
  POST   /api/v1/forecast             - Get demand forecast
  GET    /api/v1/recommendations      - Get reorder recommendations
  GET    /api/v1/metrics              - Model performance metrics
  GET    /api/v1/products             - List all products
  POST   /api/v1/products             - Create product
  PUT    /api/v1/products/<id>        - Update product
  DELETE /api/v1/products/<id>        - Delete product
"""

import sys
import logging
import numpy as np
import pandas as pd
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

# Allow importing database.py from the same directory when run directly
sys.path.insert(0, str(Path(__file__).parent))
from database import SessionLocal, Product, init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Initialise DB + seed products on startup
init_db()

ROOT = Path(__file__).parents[2]
MODELS_DIR = ROOT / "models"
TRAIN_CSV = ROOT / "data" / "raw" / "train.csv"

FEATURE_COLS = [
    "store", "item",
    "year", "month", "day", "day_of_week", "day_of_year", "week", "quarter",
    "is_weekend", "is_month_end",
    "lag_7", "lag_14", "lag_30",
    "roll_mean_7", "roll_mean_14", "roll_mean_30",
    "roll_std_7", "roll_std_14", "roll_std_30",
]

# ---------------------------------------------------------------------------
# Feature engineering (mirrors full_pipeline.ipynb)
# ---------------------------------------------------------------------------

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["store", "item", "date"]).copy()

    df["year"]         = df["date"].dt.year
    df["month"]        = df["date"].dt.month
    df["day"]          = df["date"].dt.day
    df["day_of_week"]  = df["date"].dt.dayofweek
    df["day_of_year"]  = df["date"].dt.dayofyear
    df["week"]         = df["date"].dt.isocalendar().week.astype(int)
    df["quarter"]      = df["date"].dt.quarter
    df["is_weekend"]   = (df["day_of_week"] >= 5).astype(int)
    df["is_month_end"] = df["date"].dt.is_month_end.astype(int)

    g = df.groupby(["store", "item"])["sales"]
    for lag in [7, 14, 30]:
        df[f"lag_{lag}"] = g.shift(lag)

    for w in [7, 14, 30]:
        df[f"roll_mean_{w}"] = g.transform(
            lambda x: x.shift(1).rolling(w, min_periods=1).mean()
        )
        df[f"roll_std_{w}"] = g.transform(
            lambda x: x.shift(1).rolling(w, min_periods=1).std()
        ).fillna(0)

    return df.dropna()


# ---------------------------------------------------------------------------
# Lazy-loaded cache (features built once on first request, ~30s)
# ---------------------------------------------------------------------------

_feature_df = None
_models: dict = {}


def _get_features() -> pd.DataFrame:
    global _feature_df
    if _feature_df is None:
        if not TRAIN_CSV.exists():
            raise FileNotFoundError(f"Training data not found: {TRAIN_CSV}")
        logger.info("Building feature matrix from train.csv (first request only)...")
        raw = pd.read_csv(TRAIN_CSV, parse_dates=["date"])
        _feature_df = build_features(raw)
        logger.info(f"Feature matrix ready: {_feature_df.shape}")
    return _feature_df


def _load_model(name: str):
    if name in _models:
        return _models[name]
    import joblib
    path = MODELS_DIR / f"{name}.pkl"
    if not path.exists():
        raise FileNotFoundError(f"Model not found: {path}. Run full_pipeline.ipynb first.")
    _models[name] = joblib.load(path)
    logger.info(f"Loaded model: {name}")
    return _models[name]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "korzinka-forecasting-api"})


@app.get("/api/v1/stores")
def list_stores():
    try:
        df = _get_features()
        stores = sorted(int(s) for s in df["store"].unique())
        return jsonify({"stores": stores, "count": len(stores)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/v1/items")
def list_items():
    try:
        df = _get_features()
        items = sorted(int(i) for i in df["item"].unique())
        return jsonify({"items": items, "count": len(items)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/v1/forecast")
def forecast():
    """
    POST /api/v1/forecast
    Body (JSON):
    {
        "store": 1,
        "item": 1,
        "horizon_days": 7,              // optional, default 7
        "model": "random_forest"        // optional: "random_forest" | "linear_regression"
    }
    """
    body = request.get_json(force=True)
    store = body.get("store")
    item = body.get("item")
    horizon = int(body.get("horizon_days", 7))
    model_name = body.get("model", "random_forest")

    if store is None or item is None:
        return jsonify({"error": "store and item are required"}), 400

    try:
        df = _get_features()
        subset = (
            df[(df["store"] == store) & (df["item"] == item)]
            .sort_values("date")
            .tail(horizon)
        )
        if subset.empty:
            return jsonify({"error": f"No data for store={store}, item={item}"}), 404

        model = _load_model(model_name)
        preds = np.clip(model.predict(subset[FEATURE_COLS]), 0, None)

        forecast_data = [
            {"date": str(row["date"].date()), "forecast": round(float(pred), 2)}
            for row, pred in zip(subset.to_dict("records"), preds)
        ]
        return jsonify({
            "store": store,
            "item": item,
            "model": model_name,
            "horizon_days": horizon,
            "forecast": forecast_data,
            "total_forecast": round(float(np.sum(preds)), 2),
        })

    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        logger.exception("Forecast error")
        return jsonify({"error": str(e)}), 500


@app.get("/api/v1/recommendations")
def recommendations():
    """
    GET /api/v1/recommendations?store=1&safety_days=3&lead_days=2

    Returns reorder recommendations for all items in the given store.
    """
    store = request.args.get("store", type=int)
    safety_days = request.args.get("safety_days", default=3, type=int)
    lead_days = request.args.get("lead_days", default=2, type=int)

    if store is None:
        return jsonify({"error": "store parameter is required"}), 400

    try:
        df = _get_features()
        model = _load_model("random_forest")

        store_df = df[df["store"] == store]
        recs = []
        for item, group in store_df.groupby("item"):
            latest = group.sort_values("date").tail(7)
            preds = np.clip(model.predict(latest[FEATURE_COLS]), 0, None)
            avg_daily = float(np.mean(preds))
            forecast_7d = float(np.sum(preds))
            safety_stock = avg_daily * safety_days
            reorder_point = avg_daily * lead_days + safety_stock
            recs.append({
                "item": int(item),
                "avg_daily_demand": round(avg_daily, 2),
                "forecast_7d": round(forecast_7d, 2),
                "safety_stock": round(safety_stock, 2),
                "reorder_point": round(reorder_point, 2),
                "order_quantity": max(0, round(forecast_7d)),
            })

        recs_sorted = sorted(recs, key=lambda x: x["forecast_7d"], reverse=True)
        return jsonify({"store": store, "recommendations": recs_sorted})

    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        logger.exception("Recommendations error")
        return jsonify({"error": str(e)}), 500


@app.get("/api/v1/metrics")
def metrics():
    """Return saved model evaluation metrics from results.csv."""
    path = MODELS_DIR / "results.csv"
    if not path.exists():
        return jsonify({"message": "No results found. Run full_pipeline.ipynb first."}), 404
    df = pd.read_csv(path, index_col="model")
    return jsonify({"metrics": df.to_dict(orient="index")})


# ---------------------------------------------------------------------------
# Sales data upload
# ---------------------------------------------------------------------------

@app.post("/api/v1/sales/upload")
def upload_sales():
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    try:
        df_new = pd.read_csv(file, parse_dates=['date'])
    except Exception as e:
        return jsonify({"error": f"Could not parse CSV: {e}"}), 400

    required = {'date', 'store', 'item', 'sales'}
    missing = required - set(df_new.columns)
    if missing:
        return jsonify({"error": f"Missing columns: {', '.join(sorted(missing))}"}), 400

    df_new = df_new[['date', 'store', 'item', 'sales']].copy()
    df_new['date'] = pd.to_datetime(df_new['date'])

    rows_incoming = len(df_new)

    if TRAIN_CSV.exists():
        df_existing = pd.read_csv(TRAIN_CSV, parse_dates=['date'])
        df_combined = pd.concat([df_existing, df_new], ignore_index=True)
    else:
        df_combined = df_new

    before = len(df_combined)
    df_combined = df_combined.drop_duplicates(subset=['date', 'store', 'item'], keep='last')
    df_combined = df_combined.sort_values(['store', 'item', 'date'])
    duplicates_dropped = before - len(df_combined)

    df_combined.to_csv(TRAIN_CSV, index=False, date_format='%Y-%m-%d')

    # Invalidate feature cache so next forecast rebuilds from new data
    global _feature_df
    _feature_df = None
    logger.info(f"Sales upload: {rows_incoming} rows in, {duplicates_dropped} duplicates dropped, {len(df_combined)} total rows")

    return jsonify({
        "message": "Upload successful. Forecast cache cleared — next request will rebuild features (~30s).",
        "rows_uploaded": rows_incoming,
        "duplicates_dropped": duplicates_dropped,
        "total_rows": len(df_combined),
    })


# ---------------------------------------------------------------------------
# Products CRUD
# ---------------------------------------------------------------------------

@app.get("/api/v1/products")
def get_products():
    db = SessionLocal()
    try:
        products = (db.query(Product)
                      .order_by(Product.item_id)
                      .all())
        return jsonify({"products": [p.to_dict() for p in products]})
    finally:
        db.close()


@app.post("/api/v1/products")
def create_product():
    data = request.get_json(force=True)
    required = ("item_id", "name", "category")
    if not all(data.get(f) for f in required):
        return jsonify({"error": "item_id, name and category are required"}), 400
    db = SessionLocal()
    try:
        if db.query(Product).filter_by(item_id=data["item_id"]).first():
            return jsonify({"error": f"item_id {data['item_id']} already exists"}), 409
        p = Product(
            item_id   = int(data["item_id"]),
            name      = data["name"].strip(),
            category  = data["category"].strip(),
            sku       = data.get("sku", "").strip(),
            is_active = True,
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        return jsonify({"product": p.to_dict()}), 201
    finally:
        db.close()


@app.put("/api/v1/products/<int:product_id>")
def update_product(product_id):
    data = request.get_json(force=True)
    db = SessionLocal()
    try:
        p = db.query(Product).filter_by(id=product_id).first()
        if not p:
            return jsonify({"error": "Product not found"}), 404
        if "name"      in data: p.name      = data["name"].strip()
        if "category"  in data: p.category  = data["category"].strip()
        if "sku"       in data: p.sku       = data["sku"].strip()
        if "is_active" in data: p.is_active = bool(data["is_active"])
        db.commit()
        db.refresh(p)
        return jsonify({"product": p.to_dict()})
    finally:
        db.close()


@app.delete("/api/v1/products/<int:product_id>")
def delete_product(product_id):
    db = SessionLocal()
    try:
        p = db.query(Product).filter_by(id=product_id).first()
        if not p:
            return jsonify({"error": "Product not found"}), 404
        db.delete(p)
        db.commit()
        return jsonify({"message": "Deleted"})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info("Starting Korzinka Forecasting API on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
