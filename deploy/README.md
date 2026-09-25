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

# 5. (Optional) Setup SSL Certificates for guild-chat.tech
# If skipped, Nginx will automatically generate self-signed certificates.
sudo certbot certonly --standalone -d guild-chat.tech
sudo cp /etc/letsencrypt/live/guild-chat.tech/fullchain.pem ~/ft_transcendence/certs/
sudo cp /etc/letsencrypt/live/guild-chat.tech/privkey.pem ~/ft_transcendence/certs/
sudo chmod 644 ~/ft_transcendence/certs/*
```

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

