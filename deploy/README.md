# OCI Free Tier Deployment Guide

This directory contains the scripts used to bootstrap an **Oracle Cloud Infrastructure (OCI) Free Tier Compute instance** and automate deployments using GitHub Actions.

---

## 1. OCI Instance Recommendation

- **Shape**: `VM.Standard.A1.Flex` (Ampere ARM64)
- **Resources**: 2 to 4 OCPUs, 12 to 24 GB RAM (Always Free Tier)
- **OS**: Ubuntu 22.04 LTS or Ubuntu 24.04 LTS
- **Boot Volume**: 47 GB - 100 GB

> **Warning:** Do not use the AMD micro instance (`VM.Standard.E2.1.Micro`). It only provides 1 GB of RAM, which is insufficient to run 3 Java Spring Boot microservices, Postgres, Mongo, and Grafana.

---

## 2. Network & Firewall Configuration (OCI Console)

In the OCI Web Console:
1. Navigate to **Networking** → **Virtual Cloud Networks (VCN)**.
2. Select your VCN and click on **Security Lists** → **Default Security List for...**.
3. Under **Ingress Rules**, click **Add Ingress Rules**:
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: `TCP`
   - **Destination Port Range**: `22, 8000, 8443` (add `80, 443` if using standard web ports)

---

## 3. Initial VM Setup (Run once on the OCI VM)

SSH into your OCI instance and run the bootstrap script:

```bash
# 1. Download or clone this repository
git clone https://github.com/Seraph919/ft_transcendence.git ~/ft_transcendence
cd ~/ft_transcendence

# 2. Run the bootstrap setup script
sudo bash deploy/setup-vm.sh

# 3. Apply docker group membership
newgrp docker

# 4. Create your production environment configuration
cp .env.example .env
nano .env

# 5. (Optional) Set up trusted TLS certificates (rootful Docker on this VM).
# Set DOMAIN in .env (bare hostname, e.g. example.com).
# Read the resolved value without sourcing the whole .env as shell code.
DOMAIN=$(docker compose config --format json | jq -r '.services.nginx.environment.DOMAIN')
# Point DOMAIN, www.DOMAIN and status.DOMAIN DNS records at the VM first.
# Port 80 must be available for Certbot's standalone challenge.
sudo certbot certonly --standalone --cert-name "$DOMAIN" -d "$DOMAIN" -d "www.$DOMAIN" -d "status.$DOMAIN"
docker compose build nginx
NGINX_GID=$(docker compose run --rm --no-deps --entrypoint id nginx -g)
sudo install -m 644 "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" certs/fullchain.pem
sudo install -m 640 -o root -g "$NGINX_GID" "/etc/letsencrypt/live/$DOMAIN/privkey.pem" certs/privkey.pem
```

`DOMAIN` also supplies the default GitHub callback and Grafana URLs in `.env.example`.
Update the registered GitHub OAuth callback when changing domains. Nginx renders
its config from the template at startup; recreate it after changing `.env`.
Existing certificates must also cover the new domain. For development, regenerate
only the self-signed certificate files if you change `DOMAIN`; do not remove all
Compose volumes, which also contain your databases.

The private key is owned by root and readable by the gateway's existing group,
not by all local users. Repeat the install commands after certificate renewal,
then restart Nginx. The same permissions apply to a custom `server.key`.
If you skip trusted certificates, the gateway reuses a self-signed certificate
from the `nginx_tls` volume; browsers still need to trust it explicitly.

---

## 4. GitHub Actions CI/CD Integration

To enable automated testing and continuous deployment on push to `main`:

1. In your GitHub repository, navigate to **Settings** → **Secrets and variables** → **Actions**.
2. Add the following repository secrets:

| Secret Name | Value Description | Example |
| :--- | :--- | :--- |
| `OCI_HOST` | Public IP address of your OCI instance | `129.151.x.x` |
| `OCI_USERNAME` | SSH username on the instance | `ubuntu` |
| `OCI_SSH_KEY` | Private SSH key (matching `~/.ssh/authorized_keys`) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `OCI_SSH_PORT` | *(Optional, defaults to 22)* | `22` |

---

## 5. Scripts Overview

- [`setup-vm.sh`](file:///home/seraph/dev/ft_transcendence/deploy/setup-vm.sh): Installs Docker, Compose, configures Docker log rotation, and opens local OS-level firewall ports.
- [`deploy.sh`](file:///home/seraph/dev/ft_transcendence/deploy/deploy.sh): Pulls the latest code from `main`, rebuilds containers via `docker compose up -d --build`, prunes stale images, and checks status. Executed automatically by GitHub Actions over SSH.

