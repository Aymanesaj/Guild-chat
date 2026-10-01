#!/usr/bin/env bash
set -eo pipefail

echo "======================================================"
echo " ft_transcendence - OCI Free Tier VM Bootstrap Script"
echo "======================================================"

if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run this script with sudo: sudo bash setup-vm.sh"
    exit 1
fi

ACTUAL_USER="${SUDO_USER:-$USER}"
echo "👤 Target user: ${ACTUAL_USER}"

echo "📦 Updating packages and installing prerequisites..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    jq \
    iptables-persistent \
    netfilter-persistent \
    certbot

if ! command -v docker &> /dev/null; then
    echo "🐳 Installing Docker Engine and Compose..."
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
else
    echo "🐳 Docker is already installed."
fi

echo "🔑 Adding ${ACTUAL_USER} to the docker group..."
usermod -aG docker "${ACTUAL_USER}"

echo "⚙️ Configuring Docker daemon logging..."
mkdir -p /etc/docker
cat <<EOF > /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker

echo "🛡️ Configuring host firewall rules (iptables)..."
PORTS=("22" "80" "443" "8000" "8443")
for PORT in "${PORTS[@]}"; do
    if ! iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
        echo "  - Opening port ${PORT}/tcp"
        iptables -I INPUT 1 -p tcp --dport "$PORT" -j ACCEPT
    else
        echo "  - Port ${PORT}/tcp already open"
    fi
done

echo "💾 Saving iptables rules..."
netfilter-persistent save

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
if [ -d "$REPO_DIR" ]; then
    echo "🔒 Preparing certs directory in ${REPO_DIR}/certs..."
    mkdir -p "${REPO_DIR}/certs"
    chown "${ACTUAL_USER}:${ACTUAL_USER}" "${REPO_DIR}/certs"
fi

echo "======================================================"
echo "✅ VM Setup Complete!"
echo "======================================================"
echo ""
echo "Next Steps:"
echo "1. Remember to allow ports 80, 443, 8000, and 8443 in your OCI VCN Ingress Rules."
echo "2. Log out and back in, or run 'newgrp docker' to apply docker group permissions."
echo "3. Clone the repo if you haven't already:"
echo "   git clone <REPO_URL> ~/ft_transcendence"
echo "4. Create your production .env file in ~/ft_transcendence/.env"
echo "5. SSL Certificate (Optional - Nginx generates self-signed certs automatically):"
echo '   Set DOMAIN in .env (for example, example.com), then follow deploy/README.md.'
echo '   Point DOMAIN, www.DOMAIN and status.DOMAIN DNS records at this VM.'
echo '   The deployment guide shows Certbot commands and safe private-key permissions.'
echo "6. Add your VM SSH private key and details to GitHub Repository Secrets:"
echo "   - OCI_HOST     : $(curl -s https://ifconfig.me || echo '<VM_PUBLIC_IP>')"
echo "   - OCI_USERNAME : ${ACTUAL_USER}"
echo "   - OCI_SSH_KEY  : <YOUR_PRIVATE_SSH_KEY>"
echo "======================================================"


