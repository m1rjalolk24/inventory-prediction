"""
SQLAlchemy models and DB initialisation.
Default: SQLite (zero-config). Override with DATABASE_URL env var for PostgreSQL.
  export DATABASE_URL=postgresql://user:pass@localhost:5432/korzinka
"""
import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker

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
            "is_active": self.is_active,
        }


# ---------------------------------------------------------------------------
# Seed data — 50 items matching the Kaggle dataset IDs
# ---------------------------------------------------------------------------
SEED_PRODUCTS = [
    (1,  "Tomatoes",           "Fresh Produce",   "SKU-001"),
    (2,  "Potatoes",           "Fresh Produce",   "SKU-002"),
    (3,  "Onions",             "Fresh Produce",   "SKU-003"),
    (4,  "Carrots",            "Fresh Produce",   "SKU-004"),
    (5,  "Cucumbers",          "Fresh Produce",   "SKU-005"),
    (6,  "White Bread",        "Bakery",          "SKU-006"),
    (7,  "Whole Wheat Bread",  "Bakery",          "SKU-007"),
    (8,  "Milk (1L)",          "Dairy & Eggs",    "SKU-008"),
    (9,  "Yogurt",             "Dairy & Eggs",    "SKU-009"),
    (10, "Butter",             "Dairy & Eggs",    "SKU-010"),
    (11, "Eggs (12-pack)",     "Dairy & Eggs",    "SKU-011"),
    (12, "Chicken Breast",     "Meat & Poultry",  "SKU-012"),
    (13, "Beef Mince",         "Meat & Poultry",  "SKU-013"),
    (14, "Lamb",               "Meat & Poultry",  "SKU-014"),
    (15, "Rice (5kg)",         "Staples",         "SKU-015"),
    (16, "Flour (2kg)",        "Staples",         "SKU-016"),
    (17, "Sugar (1kg)",        "Staples",         "SKU-017"),
    (18, "Sunflower Oil (1L)", "Staples",         "SKU-018"),
    (19, "Pasta",              "Staples",         "SKU-019"),
    (20, "Instant Noodles",    "Staples",         "SKU-020"),
    (21, "Water (1.5L)",       "Beverages",       "SKU-021"),
    (22, "Carbonated Drinks",  "Beverages",       "SKU-022"),
    (23, "Orange Juice",       "Beverages",       "SKU-023"),
    (24, "Tea (100g)",         "Beverages",       "SKU-024"),
    (25, "Instant Coffee",     "Beverages",       "SKU-025"),
    (26, "Sliced Cheese",      "Dairy & Eggs",    "SKU-026"),
    (27, "Sour Cream",         "Dairy & Eggs",    "SKU-027"),
    (28, "Kefir",              "Dairy & Eggs",    "SKU-028"),
    (29, "Ice Cream",          "Dairy & Eggs",    "SKU-029"),
    (30, "Frozen Vegetables",  "Frozen & Canned", "SKU-030"),
    (31, "Canned Tomatoes",    "Frozen & Canned", "SKU-031"),
    (32, "Ketchup",            "Condiments",      "SKU-032"),
    (33, "Mayonnaise",         "Condiments",      "SKU-033"),
    (34, "Salt (1kg)",         "Staples",         "SKU-034"),
    (35, "Black Pepper",       "Condiments",      "SKU-035"),
    (36, "Chips",              "Snacks & Sweets",  "SKU-036"),
    (37, "Chocolate Bar",      "Snacks & Sweets",  "SKU-037"),
    (38, "Cookies",            "Snacks & Sweets",  "SKU-038"),
    (39, "Candy",              "Snacks & Sweets",  "SKU-039"),
    (40, "Chewing Gum",        "Snacks & Sweets",  "SKU-040"),
    (41, "Laundry Detergent",  "Household",       "SKU-041"),
    (42, "Dish Soap",          "Household",       "SKU-042"),
    (43, "Toilet Paper",       "Household",       "SKU-043"),
    (44, "Shampoo",            "Household",       "SKU-044"),
    (45, "Toothpaste",         "Household",       "SKU-045"),
    (46, "Wet Wipes",          "Household",       "SKU-046"),
    (47, "Diapers",            "Household",       "SKU-047"),
    (48, "Bananas",            "Fresh Produce",   "SKU-048"),
    (49, "Apples",             "Fresh Produce",   "SKU-049"),
    (50, "Watermelon",         "Fresh Produce",   "SKU-050"),
]


def init_db():
    """Create tables and seed products if empty."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Product).count() == 0:
            for item_id, name, category, sku in SEED_PRODUCTS:
                db.add(Product(item_id=item_id, name=name,
                               category=category, sku=sku))
            db.commit()
    finally:
        db.close()
