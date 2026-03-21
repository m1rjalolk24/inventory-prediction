#!/bin/bash
# =============================================================================
# Korzinka Inventory — One-time Azure VM Setup
# =============================================================================
set -e

REPO="https://github.com/m1rjalolk24/inventory-prediction.git"
APP_DIR="/home/azureuser/app"
VENV_DIR="/home/azureuser/venv"

echo "=============================="
echo " 1. System packages"
echo "=============================="
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.11 python3.11-venv python3-pip nginx git curl

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "=============================="
echo " 2. Clone repository"
echo "=============================="
git clone "$REPO" "$APP_DIR"

echo "=============================="
echo " 3. Python virtual environment"
echo "=============================="
python3.11 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$APP_DIR/requirements.txt" gunicorn

echo "=============================="
echo " 4. Build React frontend"
echo "=============================="
cd "$APP_DIR/frontend"
npm install
npm run build

echo "=============================="
echo " 5. Create required directories"
echo "=============================="
mkdir -p "$APP_DIR/models"
mkdir -p "$APP_DIR/data/raw"

echo "=============================="
echo " 6. Install systemd service"
echo "=============================="
sudo cp "$APP_DIR/deployment/korzinka-api.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable korzinka-api

echo "=============================="
echo " 7. Configure nginx"
echo "=============================="
sudo cp "$APP_DIR/deployment/nginx.conf" /etc/nginx/sites-available/korzinka
sudo ln -sf /etc/nginx/sites-available/korzinka /etc/nginx/sites-enabled/korzinka
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo ""
echo "=============================="
echo " Setup complete!"
echo "=============================="
echo ""
echo "Next steps:"
echo "  1. Upload model files (see README — Deployment section)"
echo "  2. Start the API:  sudo systemctl start korzinka-api"
echo "  3. Check status:   sudo systemctl status korzinka-api"
echo "  4. View logs:      sudo journalctl -u korzinka-api -f"
