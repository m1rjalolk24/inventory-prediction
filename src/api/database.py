"""
SQLAlchemy models and DB initialisation.
Default: SQLite (zero-config). Override with DATABASE_URL env var for PostgreSQL.
  export DATABASE_URL=postgresql://user:pass@localhost:5432/korzinka
"""
import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Date
from sqlalchemy.orm import declarative_base, sessionmaker
from werkzeug.security import generate_password_hash

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./korzinka.db")

_kwargs = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine       = create_engine(DATABASE_URL, connect_args=_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base         = declarative_base()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Product(Base):
    __tablename__ = "products"

    id         = Column(Integer, primary_key=True, index=True)
    item_id    = Column(Integer, unique=True, nullable=False)   # Kaggle item ID 1-50
    name       = Column(String(100), nullable=False)
    category   = Column(String(50),  nullable=False)
    sku        = Column(String(20))
    unit       = Column(String(20), nullable=False, default="pcs")
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":        self.id,
            "item_id":   self.item_id,
            "name":      self.name,
            "category":  self.category,
            "sku":       self.sku or "",
            "unit":      self.unit,
            "is_active": self.is_active,
        }


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    username      = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(256), nullable=False)
    role          = Column(String(20), nullable=False, default="planner")  # 'planner' | 'admin'
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":       self.id,
            "username": self.username,
            "role":     self.role,
            "is_active": self.is_active,
        }


class DailySales(Base):
    __tablename__ = "daily_sales"

    id         = Column(Integer, primary_key=True, index=True)
    date       = Column(Date, nullable=False)
    store_id   = Column(Integer, nullable=False)
    item_id    = Column(Integer, nullable=False)
    quantity   = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":       self.id,
            "date":     str(self.date),
            "store_id": self.store_id,
            "item_id":  self.item_id,
            "quantity": self.quantity,
        }


# ---------------------------------------------------------------------------
# Seed data — 50 items matching the Kaggle dataset IDs
# ---------------------------------------------------------------------------
SEED_PRODUCTS = [
    (1,  "Tomatoes",           "Fresh Produce",   "SKU-001", "kg"),
    (2,  "Potatoes",           "Fresh Produce",   "SKU-002", "kg"),
    (3,  "Onions",             "Fresh Produce",   "SKU-003", "kg"),
    (4,  "Carrots",            "Fresh Produce",   "SKU-004", "kg"),
    (5,  "Cucumbers",          "Fresh Produce",   "SKU-005", "kg"),
    (6,  "White Bread",        "Bakery",          "SKU-006", "pcs"),
    (7,  "Whole Wheat Bread",  "Bakery",          "SKU-007", "pcs"),
    (8,  "Milk (1L)",          "Dairy & Eggs",    "SKU-008", "L"),
    (9,  "Yogurt",             "Dairy & Eggs",    "SKU-009", "pcs"),
    (10, "Butter",             "Dairy & Eggs",    "SKU-010", "pcs"),
    (11, "Eggs (12-pack)",     "Dairy & Eggs",    "SKU-011", "pack"),
    (12, "Chicken Breast",     "Meat & Poultry",  "SKU-012", "kg"),
    (13, "Beef Mince",         "Meat & Poultry",  "SKU-013", "kg"),
    (14, "Lamb",               "Meat & Poultry",  "SKU-014", "kg"),
    (15, "Rice (5kg)",         "Staples",         "SKU-015", "bag"),
    (16, "Flour (2kg)",        "Staples",         "SKU-016", "bag"),
    (17, "Sugar (1kg)",        "Staples",         "SKU-017", "kg"),
    (18, "Sunflower Oil (1L)", "Staples",         "SKU-018", "L"),
    (19, "Pasta",              "Staples",         "SKU-019", "pcs"),
    (20, "Instant Noodles",    "Staples",         "SKU-020", "pcs"),
    (21, "Water (1.5L)",       "Beverages",       "SKU-021", "L"),
    (22, "Carbonated Drinks",  "Beverages",       "SKU-022", "pcs"),
    (23, "Orange Juice",       "Beverages",       "SKU-023", "L"),
    (24, "Tea (100g)",         "Beverages",       "SKU-024", "pcs"),
    (25, "Instant Coffee",     "Beverages",       "SKU-025", "pcs"),
    (26, "Sliced Cheese",      "Dairy & Eggs",    "SKU-026", "pcs"),
    (27, "Sour Cream",         "Dairy & Eggs",    "SKU-027", "pcs"),
    (28, "Kefir",              "Dairy & Eggs",    "SKU-028", "L"),
    (29, "Ice Cream",          "Dairy & Eggs",    "SKU-029", "pcs"),
    (30, "Frozen Vegetables",  "Frozen & Canned", "SKU-030", "pcs"),
    (31, "Canned Tomatoes",    "Frozen & Canned", "SKU-031", "pcs"),
    (32, "Ketchup",            "Condiments",      "SKU-032", "pcs"),
    (33, "Mayonnaise",         "Condiments",      "SKU-033", "pcs"),
    (34, "Salt (1kg)",         "Staples",         "SKU-034", "kg"),
    (35, "Black Pepper",       "Condiments",      "SKU-035", "pcs"),
    (36, "Chips",              "Snacks & Sweets", "SKU-036", "pcs"),
    (37, "Chocolate Bar",      "Snacks & Sweets", "SKU-037", "pcs"),
    (38, "Cookies",            "Snacks & Sweets", "SKU-038", "pcs"),
    (39, "Candy",              "Snacks & Sweets", "SKU-039", "pcs"),
    (40, "Chewing Gum",        "Snacks & Sweets", "SKU-040", "pcs"),
    (41, "Laundry Detergent",  "Household",       "SKU-041", "pcs"),
    (42, "Dish Soap",          "Household",       "SKU-042", "pcs"),
    (43, "Toilet Paper",       "Household",       "SKU-043", "pcs"),
    (44, "Shampoo",            "Household",       "SKU-044", "pcs"),
    (45, "Toothpaste",         "Household",       "SKU-045", "pcs"),
    (46, "Wet Wipes",          "Household",       "SKU-046", "pcs"),
    (47, "Diapers",            "Household",       "SKU-047", "pcs"),
    (48, "Bananas",            "Fresh Produce",   "SKU-048", "kg"),
    (49, "Apples",             "Fresh Produce",   "SKU-049", "kg"),
    (50, "Watermelon",         "Fresh Produce",   "SKU-050", "kg"),
]


SEED_USERS = [
    ("admin",    "Admin@1234",   "admin"),
    ("planner1", "Planner@1234", "planner"),
]


def init_db():
    """Create tables and seed products + users if empty."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Product).count() == 0:
            for item_id, name, category, sku, unit in SEED_PRODUCTS:
                db.add(Product(item_id=item_id, name=name,
                               category=category, sku=sku, unit=unit))
            db.commit()
        if db.query(User).count() == 0:
            for username, password, role in SEED_USERS:
                db.add(User(
                    username=username,
                    password_hash=generate_password_hash(password),
                    role=role,
                ))
            db.commit()
    finally:
        db.close()
