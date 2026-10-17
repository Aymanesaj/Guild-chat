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
   - **Destination Port Range**: `22, 80, 443`

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
# Point DOMAIN and status.DOMAIN DNS records at the VM first (see below).
# Port 80 must be available for Certbot's standalone challenge.
sudo certbot certonly --standalone --cert-name "$DOMAIN" -d "$DOMAIN" -d "status.$DOMAIN"
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

### Status page DNS and certificate

Set `DOMAIN=guild-chat.tech` in the VM's `.env`. The gateway redirects
`https://guild-chat.tech/status` to `https://status.guild-chat.tech/`.
The status hostname needs its own DNS record and must be covered by the certificate.

In the DNS panel for your domain, point these records at the VM's public IPv4 address:

| Type | Name / Host | Value |
| --- | --- | --- |
| A | `@` | VM public IPv4 address |
| A | `status` | VM public IPv4 address |

If you also use `www`, add an A record for `www` and include `-d "www.$DOMAIN"`
in the certificate request. Every requested hostname must resolve to the VM.
Wait for DNS caches to refresh, then check on the VM:

```bash
getent ahostsv4 guild-chat.tech
getent ahostsv4 status.guild-chat.tech
```

"Server not found" or `NXDOMAIN` means DNS has not resolved the hostname.
Rebuilding Docker containers does not create public DNS records.

To add the status hostname to an existing certificate, run on the VM:

```bash
cd ~/ft_transcendence
DOMAIN=$(docker compose config --format json | jq -r '.services.nginx.environment.DOMAIN')
sudo certbot certificates
```

Use the listed **Certificate Name** for `CERT_NAME` below. When expanding a
certificate, keep all its existing domains in the request and add the status
hostname. For a certificate currently covering only the main domain:

```bash
CERT_NAME="$DOMAIN"
NGINX_GID=$(docker compose exec -T nginx id -g)
docker compose stop nginx

sudo certbot certonly --standalone --cert-name "$CERT_NAME" --expand \
    -d "$DOMAIN" -d "status.$DOMAIN"
```

Standalone validation uses port 80, which must be reachable from the Internet.
The website is briefly offline while Nginx is stopped. If Certbot fails, run
`docker compose start nginx` to restore the website before troubleshooting.
See the [Certbot documentation](https://eff-certbot.readthedocs.io/en/stable/using.html#re-creating-and-updating-existing-certificates).

After Certbot succeeds, copy the new files into the gateway's mounted directory:

```bash
sudo install -m 644 "/etc/letsencrypt/live/$CERT_NAME/fullchain.pem" certs/fullchain.pem
sudo install -m 640 -o root -g "$NGINX_GID" "/etc/letsencrypt/live/$CERT_NAME/privkey.pem" certs/privkey.pem
docker compose start nginx
curl -I "https://status.$DOMAIN"
```

The gateway's startup script copies these mounted files into its TLS volume.
Updating only `/etc/letsencrypt/live/` does not update the certificate it serves;
repeat the copy and restart steps after renewal.

---

## 4. GitHub Actions CI/CD Integration

CI runs on pushes and pull requests. The deployment job in
`.github/workflows/ci-cd.yml` deploys pushes to `main` after all CI jobs pass.
It passes `${{ github.sha }}` to the VM,
fetches that exact commit, and checks it out detached before running the deployment
script. Deployments are serialized, and local checkout changes cause a failure
instead of being discarded.

To configure the deployment job:

1. In your GitHub repository, navigate to **Settings** → **Secrets and variables** → **Actions**.
2. Add the following repository secrets:

| Secret Name | Value Description | Example |
| :--- | :--- | :--- |
| `OCI_HOST` | Public IP address of your OCI instance | `129.151.x.x` |
| `OCI_USERNAME` | SSH username on the instance | `ubuntu` |
| `OCI_SSH_KEY` | Private SSH key (matching `~/.ssh/authorized_keys`) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `OCI_SSH_PORT` | *(Optional, defaults to 22)* | `22` |

For a manual deployment, copy the full commit SHA from a successful CI run:

```bash
DEPLOY_SHA='<full-40-character-tested-commit-sha>'
git fetch --no-tags origin "$DEPLOY_SHA"
git checkout --detach "$DEPLOY_SHA"
bash deploy/deploy.sh "$DEPLOY_SHA"
```

`deploy.sh` requires that exact commit to be checked out with no local changes;
it never pulls `main`. Keep `.env`, certificates, and backups in their ignored
runtime locations. This pins the source revision. Images are still built on the
VM from the repository's existing base-image tags, so builds are not guaranteed
to be byte-for-byte identical; immutable image releases would be a separate step.

The frontend uses Node 22 in both CI and its Docker build. The root and frontend
Docker contexts exclude environment files, certificates, private keys, and backups.

### Deployment verification

`deploy.sh` validates Compose and builds images before updating running containers.
It waits for services to become running or healthy, restarts Nginx to refresh
upstream addresses and mounted certificates, then verifies container readiness again.
Jobs referenced by a `service_completed_successfully` dependency must exit with
code `0`; other services must stay running. Services without health checks are
checked for process state only.

The script then requests these paths through the VM's published HTTPS port:

- `/` must return HTTP 200.
- `/api/users/health` must identify `identity-service` with status `ok`.
- `/api/orgs/actuator/health` and `/api/chat/actuator/health` must report `UP`.

API checks require HTTP 200 and the expected JSON, so redirects and frontend
fallback pages do not count as healthy APIs. Requests connect to `127.0.0.1` using
Compose's resolved `DOMAIN` for the Host header, SNI and certificate validation.
They verify local ingress, TLS and proxy routing; public DNS, the OCI firewall,
external reachability and authenticated user flows are outside these checks.

TLS verification is enabled. Production certificates must be trusted and match
`DOMAIN`. For a private CA or a development self-signed certificate, supply its
PEM file using `DEPLOY_CA_CERT`; there is no automatic insecure fallback.

Export these optional settings in the deployment shell (they are not loaded from
the application's `.env`):

| Setting | Default | Purpose |
| --- | --- | --- |
| `DEPLOY_WAIT_TIMEOUT` | `300` | Maximum seconds for each container readiness phase |
| `DEPLOY_HTTP_TIMEOUT` | `30` | Maximum seconds per HTTPS request |
| `DEPLOY_LOG_TAIL` | `80` | Maximum recent log lines per service on failure |
| `DEPLOY_CA_CERT` | System trust store | Path to a custom CA certificate for curl |

```bash
DEPLOY_WAIT_TIMEOUT=420 bash deploy/deploy.sh "$DEPLOY_SHA"
```

Failures return a nonzero exit code and print all container statuses, state and
health-check output for failing containers, and recent logs for affected services
and their direct dependencies. If no affected service can be identified, the script
shows recent logs for the whole stack. It does not print resolved Compose
configuration or container environment variables. Container logs themselves may
contain application-generated sensitive information.

Image pruning runs only after container and HTTP checks pass. The script does not
delete volumes or attempt automatic rollback. CI tests these decisions with fake
Docker and curl commands; the actual deployment performs the live checks.

---

## 5. Scripts Overview

- [`setup-vm.sh`](setup-vm.sh): Installs Docker, Compose, configures Docker log rotation, and opens local OS-level firewall ports.
- [`deploy.sh`](deploy.sh): Verifies the tested SHA and clean checkout, builds images, checks container readiness and HTTPS APIs, reports failures, and prunes dangling images after successful verification.
- [`test_deploy.py`](test_deploy.py): Tests deployment success and failure handling without starting containers or making network requests. Run with `python3 deploy/test_deploy.py`.
