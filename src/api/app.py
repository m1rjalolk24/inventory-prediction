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
import jwt
import json
import os
import threading
import datetime
import logging
import numpy as np
import pandas as pd
from pathlib import Path
from functools import wraps
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import check_password_hash

# Allow importing database.py from the same directory when run directly
sys.path.insert(0, str(Path(__file__).parent))
from database import SessionLocal, Product, DailySales, StockLevel, User, init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------
JWT_SECRET  = os.environ.get("JWT_SECRET", "korzinka-dev-secret-change-in-prod")
JWT_EXPIRY  = 8  # hours


def _make_token(user):
    payload = {
        "sub":      str(user.id),
        "username": user.username,
        "role":     user.role,
        "exp":      datetime.datetime.utcnow() + datetime.timedelta(hours=JWT_EXPIRY),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def require_auth(*roles):
    """Decorator — validates Bearer JWT and optionally checks role."""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
            if not token:
                return jsonify({"error": "Authentication required"}), 401
            try:
                payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            except jwt.ExpiredSignatureError:
                return jsonify({"error": "Session expired — please log in again"}), 401
            except jwt.InvalidTokenError:
                return jsonify({"error": "Invalid token"}), 401
            if roles and payload.get("role") not in roles:
                return jsonify({"error": "Insufficient permissions"}), 403
            request.current_user = payload
            return f(*args, **kwargs)
        return wrapper
    return decorator

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
# Auth endpoints
# ---------------------------------------------------------------------------

@app.post("/api/v1/auth/login")
def login():
    body = request.get_json(force=True)
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(username=username).first()
        if not user or not user.is_active or not check_password_hash(user.password_hash, password):
            return jsonify({"error": "Invalid username or password"}), 401
        token = _make_token(user)
        return jsonify({"token": token, "username": user.username, "role": user.role})
    finally:
        db.close()


@app.get("/api/v1/auth/me")
@require_auth("planner", "admin")
def me():
    return jsonify(request.current_user)


# ---------------------------------------------------------------------------
# Lazy-loaded cache (features built once on first request, ~30s)
# ---------------------------------------------------------------------------

_feature_df = None
_models: dict = {}
_retrain_status: dict = {"state": "idle", "message": "", "started_at": None, "finished_at": None}


def _get_features() -> pd.DataFrame:
    global _feature_df
    if _feature_df is None:
        if not TRAIN_CSV.exists():
            raise FileNotFoundError(f"Training data not found: {TRAIN_CSV}")
        logger.info("Building feature matrix from train.csv (first request only)...")
        raw = pd.read_csv(TRAIN_CSV)
        raw["date"] = pd.to_datetime(raw["date"].astype(str).str[:10], format="%Y-%m-%d")
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


def _get_or_init_stock(db, store_id: int, item_id: int, avg_daily: float) -> float:
    """Return current stock from DB; initialise using simulateStock formula if missing."""
    row = db.query(StockLevel).filter_by(store_id=store_id, item_id=item_id).first()
    if row is None:
        sim_days = (item_id * 17 + store_id * 31) % 9 + 2
        quantity = round(avg_daily * sim_days)
        row = StockLevel(store_id=store_id, item_id=item_id, quantity=float(quantity))
        db.add(row)
        db.commit()
        db.refresh(row)
    return float(row.quantity)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "korzinka-forecasting-api"})


@app.get("/api/v1/stores")
@require_auth("planner", "admin")
def list_stores():
    try:
        df = _get_features()
        stores = sorted(int(s) for s in df["store"].unique())
        return jsonify({"stores": stores, "count": len(stores)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/v1/items")
@require_auth("planner", "admin")
def list_items():
    try:
        df = _get_features()
        items = sorted(int(i) for i in df["item"].unique())
        return jsonify({"items": items, "count": len(items)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/v1/forecast")
@require_auth("planner", "admin")
def forecast():
    if _retrain_status.get("state") == "running":
        return jsonify({"error": "Model retraining in progress. Try again in a few minutes."}), 503
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
@require_auth("planner", "admin")
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

        # Load unit map from DB
        db = SessionLocal()
        try:
            unit_map = {p.item_id: p.unit for p in db.query(Product).all()}

            store_df = df[df["store"] == store]
            recs = []
            for item, group in store_df.groupby("item"):
                latest = group.sort_values("date").tail(7)
                preds = np.clip(model.predict(latest[FEATURE_COLS]), 0, None)
                avg_daily = float(np.mean(preds))
                forecast_7d = float(np.sum(preds))
                safety_stock = avg_daily * safety_days
                reorder_point = avg_daily * lead_days + safety_stock
                current_stock = _get_or_init_stock(db, store, int(item), avg_daily)
                recs.append({
                    "item":             int(item),
                    "avg_daily_demand": round(avg_daily, 2),
                    "forecast_7d":      round(forecast_7d, 2),
                    "safety_stock":     round(safety_stock, 2),
                    "reorder_point":    round(reorder_point, 2),
                    "order_quantity":   max(0, round(forecast_7d)),
                    "unit":             unit_map.get(int(item), "pcs"),
                    "current_stock":    round(current_stock, 2),
                })
        finally:
            db.close()

        recs_sorted = sorted(recs, key=lambda x: x["forecast_7d"], reverse=True)
        return jsonify({"store": store, "recommendations": recs_sorted})

    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        logger.exception("Recommendations error")
        return jsonify({"error": str(e)}), 500


@app.get("/api/v1/transfer-suggestions")
@require_auth("planner", "admin")
def transfer_suggestions():
    """
    GET /api/v1/transfer-suggestions?store=1

    For the given store, finds products that are overstocked (current stock > 2× 7-day forecast)
    and matches them with other stores that are understocked for the same product.
    Stock levels are computed using the same deterministic formula as the frontend simulateStock().
    """
    store = request.args.get("store", type=int)
    if store is None:
        return jsonify({"error": "store parameter is required"}), 400

    try:
        df = _get_features()
        model = _load_model("random_forest")

        db = SessionLocal()
        try:
            unit_map = {p.item_id: p.unit for p in db.query(Product).all()}
            name_map = {p.item_id: p.name for p in db.query(Product).all()}

            all_stores = sorted(df["store"].unique())

            # Build stock snapshot for every (store, item) pair using DB stock levels
            stock = {}
            for s in all_stores:
                store_df = df[df["store"] == s]
                for item, group in store_df.groupby("item"):
                    latest = group.sort_values("date").tail(7)
                    preds = np.clip(model.predict(latest[FEATURE_COLS]), 0, None)
                    avg_daily = float(np.mean(preds))
                    forecast_7d = float(np.sum(preds))
                    reorder_pt = avg_daily * 5  # safety_days=3 + lead_days=2
                    current = _get_or_init_stock(db, int(s), int(item), avg_daily)
                    stock[(int(s), int(item))] = {
                        "avg_daily":   avg_daily,
                        "forecast_7d": forecast_7d,
                        "reorder_pt":  reorder_pt,
                        "current":     current,
                    }
        finally:
            db.close()

        suggestions = []
        for item in df[df["store"] == store]["item"].unique():
            from_d = stock.get((store, int(item)))
            if not from_d or from_d["current"] <= from_d["forecast_7d"] * 2:
                continue  # not overstocked
            excess = from_d["current"] - round(from_d["forecast_7d"])
            for to_store in all_stores:
                if int(to_store) == store or excess <= 0:
                    continue
                to_d = stock.get((int(to_store), int(item)))
                if not to_d or to_d["current"] >= to_d["reorder_pt"]:
                    continue  # destination has enough stock
                need = round(to_d["forecast_7d"] - to_d["current"])
                qty = min(excess, max(0, need))
                if qty <= 0:
                    continue
                unit = unit_map.get(int(item), "pcs")
                suggestions.append({
                    "item":         int(item),
                    "name":         name_map.get(int(item), f"Product {item}"),
                    "to_store":     int(to_store),
                    "transfer_qty": qty,
                    "reason": (
                        f"Store {to_store} has {to_d['current']} {unit} "
                        f"vs {round(to_d['forecast_7d'])} {unit} 7d demand"
                    ),
                })
                excess -= qty

        return jsonify({"store": store, "suggestions": suggestions})

    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        logger.exception("Transfer suggestions error")
        return jsonify({"error": str(e)}), 500


@app.get("/api/v1/metrics")
@require_auth("planner", "admin")
def metrics():
    """Return saved model evaluation metrics from results.csv."""
    path = MODELS_DIR / "results.csv"
    if not path.exists():
        return jsonify({"message": "No results found. Run full_pipeline.ipynb first."}), 404
    df = pd.read_csv(path, index_col="model")
    return jsonify({"metrics": df.to_dict(orient="index")})


# ---------------------------------------------------------------------------
# Background jobs: model retrain
# ---------------------------------------------------------------------------


def _do_retrain():
    global _feature_df, _models, _retrain_status
    import joblib
    from sklearn.ensemble import RandomForestRegressor

    try:
        _retrain_status.update({"state": "running", "message": "Building feature matrix…"})
        raw = pd.read_csv(TRAIN_CSV)
        raw["date"] = pd.to_datetime(raw["date"].astype(str).str[:10], format="%Y-%m-%d")
        feat_df = build_features(raw)

        # Free old model from memory before training to save ~700MB RAM
        _models.pop("random_forest", None)

        _retrain_status["message"] = f"Training on {len(feat_df):,} rows…"
        model = RandomForestRegressor(
            n_estimators=100, max_depth=10,
            min_samples_leaf=4, random_state=42, n_jobs=1,
        )
        model.fit(feat_df[FEATURE_COLS], feat_df["sales"])

        _retrain_status["message"] = "Saving model to disk…"
        joblib.dump(model, MODELS_DIR / "random_forest.pkl")

        _models["random_forest"] = model
        _feature_df = feat_df

        _retrain_status.update({
            "state": "done",
            "message": f"Done — retrained on {len(feat_df):,} rows.",
            "finished_at": datetime.datetime.now().isoformat(),
        })
        logger.info("Retraining complete")
    except Exception as e:
        _retrain_status.update({"state": "error", "message": str(e)})
        logger.exception("Retrain error")


@app.post("/api/v1/jobs/retrain")
@require_auth("admin")
def run_retrain():
    global _retrain_status
    if _retrain_status.get("state") == "running":
        return jsonify({"error": "Retraining already in progress"}), 409
    _retrain_status = {
        "state": "running", "message": "Starting…",
        "started_at": datetime.datetime.now().isoformat(), "finished_at": None,
    }
    threading.Thread(target=_do_retrain, daemon=True).start()
    return jsonify({"message": "Retraining started", "status": _retrain_status})


@app.get("/api/v1/jobs/retrain/status")
@require_auth("planner", "admin")
def retrain_status():
    return jsonify(_retrain_status)


# ---------------------------------------------------------------------------
# Sales data upload
# ---------------------------------------------------------------------------

@app.post("/api/v1/sales/upload")
@require_auth("admin")
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


@app.post("/api/v1/sales/upload-pos")
@require_auth("admin")
def upload_pos():
    """
    Flexible POS CSV upload with column mapping.
    Form fields:
        file:    CSV file
        mapping: JSON string {date, store, item, quantity}  →  column names in the CSV
    Handles:
        - Any column names via mapping
        - SKU / numeric item resolution against products table
        - Multiple orders per day → aggregated to daily totals
        - Various date formats
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    try:
        mapping = json.loads(request.form.get("mapping", "{}"))
    except Exception:
        return jsonify({"error": "Invalid mapping JSON"}), 400

    for field in ("date", "store", "item", "quantity"):
        if field not in mapping:
            return jsonify({"error": f"Mapping missing field: {field}"}), 400

    try:
        df = pd.read_csv(request.files["file"], dtype=str)
    except Exception as e:
        return jsonify({"error": f"Could not parse CSV: {e}"}), 400

    missing_cols = [v for v in mapping.values() if v not in df.columns]
    if missing_cols:
        return jsonify({"error": f"Columns not found in CSV: {', '.join(missing_cols)}"}), 400

    # Extract mapped columns
    df_mapped = pd.DataFrame({
        "date":  df[mapping["date"]],
        "store": df[mapping["store"]],
        "item":  df[mapping["item"]],
        "sales": df[mapping["quantity"]],
    })

    # Parse dates — strip time component, handle various formats
    try:
        df_mapped["date"] = pd.to_datetime(
            df_mapped["date"].astype(str).str[:10], format="mixed"
        ).dt.normalize()
    except Exception as e:
        return jsonify({"error": f"Could not parse dates: {e}"}), 400

    # Resolve item column → numeric item_id
    db = SessionLocal()
    try:
        products = db.query(Product).all()
    finally:
        db.close()

    sku_to_id  = {p.sku.strip(): p.item_id for p in products if p.sku}
    name_to_id = {p.name.strip().lower(): p.item_id for p in products}

    def resolve_item(val):
        s = str(val).strip()
        try:
            return int(float(s))          # already numeric
        except ValueError:
            pass
        if s in sku_to_id:
            return sku_to_id[s]           # exact SKU match
        if s.lower() in name_to_id:
            return name_to_id[s.lower()]  # product name match
        return None

    df_mapped["item"]  = df_mapped["item"].apply(resolve_item)
    unresolved         = int(df_mapped["item"].isna().sum())
    df_mapped          = df_mapped.dropna(subset=["item"])
    df_mapped["item"]  = df_mapped["item"].astype(int)
    df_mapped["store"] = pd.to_numeric(df_mapped["store"], errors="coerce")
    df_mapped          = df_mapped.dropna(subset=["store"])
    df_mapped["store"] = df_mapped["store"].astype(int)
    df_mapped["sales"] = pd.to_numeric(df_mapped["sales"], errors="coerce").fillna(0).astype(int)

    # Aggregate order-level rows → daily store+item totals
    df_agg = (
        df_mapped
        .groupby(["date", "store", "item"], as_index=False)["sales"]
        .sum()
    )
    rows_incoming = len(df_agg)

    if TRAIN_CSV.exists():
        df_existing         = pd.read_csv(TRAIN_CSV)
        df_existing["date"] = pd.to_datetime(
            df_existing["date"].astype(str).str[:10], format="%Y-%m-%d"
        )
        df_combined = pd.concat([df_existing, df_agg], ignore_index=True)
    else:
        df_combined = df_agg

    before             = len(df_combined)
    df_combined        = df_combined.drop_duplicates(subset=["date", "store", "item"], keep="last")
    df_combined        = df_combined.sort_values(["store", "item", "date"])
    duplicates_dropped = before - len(df_combined)

    df_combined.to_csv(TRAIN_CSV, index=False, date_format="%Y-%m-%d")

    global _feature_df
    _feature_df = None

    # Decrement StockLevel for every uploaded sale row
    db = SessionLocal()
    try:
        for _, row in df_agg.iterrows():
            store_id = int(row["store"])
            item_id  = int(row["item"])
            qty      = int(row["sales"])
            stock_row = db.query(StockLevel).filter_by(
                store_id=store_id, item_id=item_id
            ).first()
            if stock_row is not None:
                stock_row.quantity = max(0.0, float(stock_row.quantity) - qty)
        db.commit()
    finally:
        db.close()

    logger.info(f"POS upload: {rows_incoming} aggregated rows, {unresolved} unresolved items, {duplicates_dropped} duplicates")

    return jsonify({
        "rows_uploaded":    rows_incoming,
        "duplicates_dropped": duplicates_dropped,
        "unresolved_items": unresolved,
        "total_rows":       len(df_combined),
    })


# ---------------------------------------------------------------------------
# POS — record sales & fetch today's totals
# ---------------------------------------------------------------------------

@app.post("/api/v1/sales/record")
@require_auth("planner", "admin")
def record_sale():
    data = request.get_json(force=True)
    store_id = data.get("store_id")
    item_id  = data.get("item_id")
    quantity = data.get("quantity")
    if not all([store_id, item_id, quantity]):
        return jsonify({"error": "store_id, item_id and quantity are required"}), 400
    if quantity <= 0:
        return jsonify({"error": "quantity must be positive"}), 400

    db = SessionLocal()
    try:
        sale = DailySales(
            date=datetime.datetime.today().date(),
            store_id=int(store_id),
            item_id=int(item_id),
            quantity=int(quantity),
        )
        db.add(sale)
        db.commit()
        db.refresh(sale)

        # Decrement persistent stock level
        stock_row = db.query(StockLevel).filter_by(
            store_id=int(store_id), item_id=int(item_id)
        ).first()
        if stock_row is not None:
            stock_row.quantity = max(0.0, float(stock_row.quantity) - int(quantity))
            db.commit()

        return jsonify({"sale": sale.to_dict()}), 201
    finally:
        db.close()


@app.post("/api/v1/stock/receive")
@require_auth("planner", "admin")
def receive_stock():
    """
    POST /api/v1/stock/receive
    Body: { store_id, item_id, quantity }
    Increments StockLevel for the given store+item.
    """
    data     = request.get_json(force=True)
    store_id = data.get("store_id")
    item_id  = data.get("item_id")
    quantity = data.get("quantity")
    if not all([store_id, item_id, quantity]):
        return jsonify({"error": "store_id, item_id and quantity are required"}), 400
    if quantity <= 0:
        return jsonify({"error": "quantity must be positive"}), 400

    db = SessionLocal()
    try:
        row = db.query(StockLevel).filter_by(
            store_id=int(store_id), item_id=int(item_id)
        ).first()
        if row is None:
            row = StockLevel(store_id=int(store_id), item_id=int(item_id), quantity=0.0)
            db.add(row)
        row.quantity = float(row.quantity) + float(quantity)
        db.commit()
        db.refresh(row)
        return jsonify({"store_id": int(store_id), "item_id": int(item_id),
                        "new_quantity": row.quantity}), 200
    finally:
        db.close()


@app.get("/api/v1/sales/today")
@require_auth("planner", "admin")
def today_sales():
    store_id = request.args.get("store", type=int)
    if store_id is None:
        return jsonify({"error": "store parameter is required"}), 400
    today = datetime.datetime.today().date()
    db = SessionLocal()
    try:
        rows = db.query(DailySales).filter_by(store_id=store_id, date=today).all()
        # Aggregate by item_id (sum all entries for the day)
        totals = {}
        for r in rows:
            totals[r.item_id] = totals.get(r.item_id, 0) + r.quantity
        return jsonify({
            "store": store_id,
            "date": str(today),
            "sales": [{"item_id": k, "quantity": v} for k, v in totals.items()],
        })
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Products CRUD
# ---------------------------------------------------------------------------

@app.get("/api/v1/products")
@require_auth("planner", "admin")
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
@require_auth("admin")
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
@require_auth("admin")
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
@require_auth("admin")
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
# User management (admin only)
# ---------------------------------------------------------------------------

@app.get("/api/v1/users")
@require_auth("admin")
def get_users():
    db = SessionLocal()
    try:
        users = db.query(User).order_by(User.id).all()
        return jsonify({"users": [u.to_dict() for u in users]})
    finally:
        db.close()


@app.post("/api/v1/users")
@require_auth("admin")
def create_user():
    from werkzeug.security import generate_password_hash
    data = request.get_json(force=True)
    if not data.get("username") or not data.get("password"):
        return jsonify({"error": "username and password are required"}), 400
    if data.get("role") not in ("admin", "planner"):
        return jsonify({"error": "role must be admin or planner"}), 400
    db = SessionLocal()
    try:
        if db.query(User).filter_by(username=data["username"]).first():
            return jsonify({"error": "Username already exists"}), 409
        u = User(
            username=data["username"].strip(),
            password_hash=generate_password_hash(data["password"]),
            role=data["role"],
        )
        db.add(u); db.commit(); db.refresh(u)
        return jsonify({"user": u.to_dict()}), 201
    finally:
        db.close()


@app.put("/api/v1/users/<int:user_id>")
@require_auth("admin")
def update_user(user_id):
    from werkzeug.security import generate_password_hash
    data = request.get_json(force=True)
    db = SessionLocal()
    try:
        u = db.query(User).filter_by(id=user_id).first()
        if not u:
            return jsonify({"error": "User not found"}), 404
        if "role"      in data and data["role"] in ("admin", "planner"): u.role      = data["role"]
        if "is_active" in data: u.is_active = bool(data["is_active"])
        if data.get("password"): u.password_hash = generate_password_hash(data["password"])
        db.commit(); db.refresh(u)
        return jsonify({"user": u.to_dict()})
    finally:
        db.close()


@app.delete("/api/v1/users/<int:user_id>")
@require_auth("admin")
def delete_user(user_id):
    db = SessionLocal()
    try:
        u = db.query(User).filter_by(id=user_id).first()
        if not u:
            return jsonify({"error": "User not found"}), 404
        # Prevent deleting the last admin
        if u.role == "admin" and db.query(User).filter_by(role="admin", is_active=True).count() <= 1:
            return jsonify({"error": "Cannot delete the last admin account"}), 400
        db.delete(u); db.commit()
        return jsonify({"message": "Deleted"})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info("Starting Korzinka Forecasting API on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
