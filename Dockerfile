FROM python:3.11-slim

WORKDIR /app

# Install only what's needed for the API (no Jupyter/viz)
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt gunicorn

# Copy source
COPY src/ src/
COPY wsgi.py .

# models/ and data/ are mounted as volumes at runtime
CMD ["gunicorn", \
     "--workers", "1", \
     "--timeout", "120", \
     "--bind", "0.0.0.0:5000", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "wsgi:app"]
