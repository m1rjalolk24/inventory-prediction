# Korzinka Inventory Forecasting System

AI-powered demand forecasting for Korzinka — Uzbekistan's largest modern grocery retailer (152 stores, UZS 9.4tn annual sales).

## Problem
- Current availability: 92% → Target: 95%+
- Shrinkage in perishables: 4.5% → Target: <3%
- Manual forecasting cannot scale to 152 stores × 3,500+ SKUs

## Solution
Compare 3 ML models for 7-day and 30-day demand forecasts:

| Model | Target MAPE | Best for |
|---|---|---|
| Linear Regression | <20% | Baseline / stable items |
| ARIMA | <12% | Fresh produce, seasonal patterns |
| **Random Forest** | **<15%** | **Overall best — complex features** |

## Tech Stack
- **Backend**: Python 3.9+, Flask
- **ML**: scikit-learn, statsmodels, pmdarima
- **Frontend**: React + Vite + Recharts
- **Database**: PostgreSQL (Phase 2)

## Project Structure
```
inventory-prediction/
├── src/
│   ├── api/app.py          # Flask REST API
│   ├── data/               # Data loaders & preprocessors
│   ├── models/             # Model implementations
│   └── utils/              # Metrics & visualization helpers
├── frontend/               # React dashboard (Vite)
├── notebooks/
│   └── full_pipeline.ipynb # EDA → training → evaluation
├── models/
│   └── results.csv         # Model comparison metrics
├── requirements.txt
└── .github/workflows/      # CI/CD (coming)
```

## Quick Start

### 1. Backend
```bash
pip install -r requirements.txt

# Train models (run full_pipeline.ipynb) OR download pre-trained models
# Then start the API:
python src/api/app.py
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

### 3. Data
Download the Kaggle Store Item Demand Forecasting dataset and place as:
- `data/raw/train.csv`
- `data/raw/test.csv`

> Dataset: https://www.kaggle.com/competitions/demand-forecasting-kernels-only/data

## API Endpoints
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/v1/forecast` | 7/30-day demand forecast |
| GET | `/api/v1/recommendations` | Restock recommendations |
| GET | `/api/v1/metrics` | Model performance metrics |

## Results
See `models/results.csv` for model comparison (MAPE, MAE, RMSE, R²).
