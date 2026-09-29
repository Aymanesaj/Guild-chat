# DevOps rehearsal, verified findings, and preparation checklist

Companion to [the implementation guide](DEVOPS_GUIDE.md) and [interview questions](DEVOPS_INTERVIEW.md). Findings below are from source inspection at `8fae988`, not a penetration test or a live availability assessment. No infrastructure fixes were applied as part of preparing these documents.

## 1. What to review first

| Priority | Review / practise | You should be able to demonstrate |
| --- | --- | --- |
| 1 | Request flow and Compose | Draw browser → gateway → service → database; explain ports, mounts, dependencies |
| 2 | CI/CD | Explain each job, deploy gate, remote commands, and why a green job isn't a full production guarantee |
| 3 | TLS, WAF, and WebSockets | Explain certificate selection, actual blocking mode, rewrites, and upgrade handling |
| 4 | Monitoring | Follow an emitted metric into Prometheus, a dashboard, and an alert |
| 5 | Backups | Explain actual coverage, restore hazards, and how a disposable recovery test works |
| 6 | Limitations | Present two or three prioritized improvements with evidence and a verification plan |

If you have four preparation sessions, use the first for architecture/Docker, the second for ingress/security/CI, the third for monitoring/recovery, and the fourth for a timed mock interview. Start each session by explaining the previous topic without notes.

## 2. Confirmed findings to understand before staff asks

These are preparation and improvement items, not changes already made.

| Finding | Evidence | Why it matters / next step |
| --- | --- | --- |
| Incomplete PostgreSQL backup coverage | Both dump scripts call `pg_dump` only for `POSTGRES_DB`; Compose gives organization a separate DB | Add both databases and required global roles to a versioned backup manifest; test restoring room/membership data |
| Restore can hide failures | MongoDB restore ends with `|| true`; `psql` lacks `ON_ERROR_STOP` | Fail explicitly and validate restored business data before reporting success |
| Backups share the host with live data | `./backups:/backups` | Add independently stored encrypted copies, retention, integrity checks, and a host-loss drill |
| Avatar files are outside backup scope | Avatar named volume exists; dump scripts cover databases | Restore profiles and their uploaded files together |
| Backup happens immediately on startup | `perform_backup` occurs before the sleep loop | A restarted backup container can replace latest with the current bad/empty state; use immutable snapshot selection and controlled promotion |
| Snapshot pairs can diverge | PostgreSQL latest copy changes before MongoDB succeeds; no lock | Publish a complete backup set atomically only after both succeed; serialize backup/restore operations |
| CPU alert uses nonexistent metric | Alert queries `container_cpu_usage_percentage`; exporter emits cumulative nanoseconds | Derive usage from the real counter and specify normalization; test pending/firing/resolved states |
| 5xx “5%” description is incorrect | Alert compares `rate(...count[5m]) > 0.05` without division | Implement a ratio with correct service aggregation and low/no-traffic handling |
| Discord receiver credential is committed | `infra/prometheus/alertmanager.yml` contains a webhook URL | Rotate/revoke it, stop tracking the secret value, and avoid printing it during demos |
| Exporter socket is a privileged interface | Docker socket mounted into exporter | Restrict daemon API access; `:ro` alone is not an API permission boundary |
| Backup/key permissions are too broad | Backup chmods and documented certificate chmod | Use restricted owners/groups and protect sensitive backup/key material |
| Deploy fetches moving `main` | Workflow reset and script pull occur at deployment time | Deploy the tested SHA or image digest; serialize deployments |
| No deployment smoke-test/rollback gate | Script ends with sleep and `compose ps` | Assert readiness and application flows, define rollback compatible with DB changes |
| Node versions differ | CI 22, frontend Docker build 24 | Align build environments and verify the actual image in CI |
| Monitoring can block ingress startup | Gateway depends on Grafana/exporter health | Separate observability availability from serving application traffic |
| Organization probe is shallow | `/healthz` returns `OK` | Use a readiness contract reflecting required dependencies |
| Exporter can serve stale data | Separate background collector and file-serving HTTP process | Emit collection timestamp/success/duration and alert on stale output |
| Custom Nginx metric URL defaults to wrong port | Exporter default is `http://nginx/nginx_status`; gateway listens on 8080 | Set the correct URL; distinguish the dedicated Nginx exporter that already uses 8080 |
| Disk metric implementation needs correction | `/proc/mounts` field 6 used instead of field 2; GNU `df --output` used in Alpine image | Fix parsing/tool compatibility and validate emitted metrics against the intended host mounts |
| “Host” telemetry has namespace limitations | No dedicated host `/proc`/`sys`/rootfs mounts or host networking | Label/document scope honestly; use a properly scoped host collector if needed |
| Stopped-container visibility is limited | Docker list call omits `all=1` | Review OOM/down detection, vanished series, and collector-failure behavior |
| Grafana plugin pruning isn't established | Reduced directory is copied onto a fresh full base | Inspect final filesystem; remove unwanted content in final image if that is the goal |
| Certificate renewal lifecycle is manual | Certbot originals copied to project; gateway copies again at startup | Automate and test refresh/reload; monitor expiry externally |
| Header inheritance needs review | Some locations declare their own `proxy_set_header` set | Ensure needed forwarded headers are explicit in each such location |
| Fragile status asset rewrite | `sub_filter` targets a minified string | Pin/test Gatus compatibility or use a supported base-path strategy |
| Vault and Loki aren't active components | Empty Vault file, no Compose services; datasource removes Loki | Describe actual environment secrets and Docker logging instead |
| Destructive convenience targets exist | `fclean` and selected Make targets include volume-removal options | Use explicit commands in demos and keep real data out of experiments |
| Missing-env Make error path is malformed | Shell branch uses `@echo` / `@exit` | Correct recipe syntax and test missing configuration behavior |
| Root build context is too broad | Root `.dockerignore` doesn't omit `.env`, `certs`, `backups` | Minimize context and explicitly exclude sensitive artifacts |

The `.gitignore` includes a broad `*.sh` rule, but `deploy/deploy.sh` and `deploy/setup-vm.sh` are already tracked. Do not report them as missing from the repository. Verify with `git ls-files`, not by reading ignore patterns alone.

## 3. Read-only demonstration commands

Run these from the repository root against your intended local/demo stack. They assume Docker and the relevant containers are available. These were documented, not executed against your running stack during this review. Logs may contain credentials/tokens or user information; inspect before screen sharing. Avoid displaying `.env`, rendered full Compose environment output, or the webhook file.

### Inventory and config syntax

```bash
git rev-parse --short HEAD
docker compose version
docker compose config -q
docker compose config --services
docker compose ps
docker compose images
docker network inspect private --format '{{json .IPAM.Config}}'
docker volume ls
```

Explain: `config -q` is configuration validation, `ps` is container state, and neither proves end-to-end application success.

### Health and focused diagnostics

```bash
docker inspect --format '{{json .State.Health}}' identity-service
docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}} {{.RestartCount}}' chat-service
docker compose logs --tail=60 nginx identity-service chat-service org-service
docker compose exec -T identity-service curl -fsS http://localhost:8083/actuator/health/readiness
docker compose exec -T org-service curl -fsS http://localhost:8082/healthz
docker compose exec -T chat-service curl -fsS http://localhost:8081/actuator/health
```

Explain what each probe actually checks. If the host port works but internal health fails, distinguish whether you are reaching a static frontend, a different route, or stale/restarted services.

### Nginx and TLS

```bash
docker compose exec -T nginx nginx -t
curl -I http://localhost:8000/
curl -I https://guild-chat.tech/
openssl s_client -connect guild-chat.tech:443 -servername guild-chat.tech -verify_return_error </dev/null
```

`nginx -t` checks configuration validity and referenced resources. HTTP should redirect. The HTTPS command checks the configured public domain and may fail if it is not currently serving this deployment. `-servername` supplies SNI so the server knows which TLS hostname is requested.

For local self-signed debugging only:

```bash
curl -k -I https://localhost:8443/
```

Explain that `-k` disables certificate verification. It is useful for isolating transport/routing from certificate trust, but it cannot prove that trust works.

The certificate scripts copy keys; never display private key contents. Inspect dates and SANs from the public certificate if available:

```bash
openssl x509 -in certs/fullchain.pem -noout -dates -subject -issuer -ext subjectAltName
```

### Metrics and alerts without sending messages

```bash
docker compose exec -T docker-exporter curl -fsS http://localhost:8090/metrics.prom
docker compose exec -T identity-service curl -fsS http://localhost:8083/actuator/prometheus
docker compose exec -T prometheus promtool check config /etc/prometheus/prometheus.yml
docker compose exec -T prometheus promtool check rules /etc/prometheus/alert_rules.yml
docker compose logs --tail=50 prometheus grafana docker-exporter
```

Inspect a small sample before presenting the full metric stream. Find one actual metric name, query it in Grafana Explore, then show the panel that uses it. Check both provisioned dashboards. Explain that rule syntax validation cannot detect every semantic error: an unknown metric can still be valid PromQL.

Queries to demonstrate:

```promql
up
container_memory_usage_bytes
rate(container_cpu_usage_total_nanoseconds[5m]) / 1e9 * 100
sum by (job) (rate(http_server_requests_seconds_count[5m]))
ALERTS
```

If a series is absent, do not call it zero. Check target health, endpoint contents, labels, and collection freshness. A metric based on actual HTTP requests may not exist until the application has served traffic.

### Backup artifacts without restoring them

```bash
ls -lh backups/
gzip -t backups/postgres_latest.sql.gz
gzip -t backups/mongo_latest.archive.gz
```

These establish existence/size and gzip integrity, not completeness, correct schema, business consistency, or restorability. Do not print SQL dumps containing user records during the interview. Latest filenames are copies; compare timestamps and use a paired manifest when improving the implementation.

### Source checks

```bash
git ls-files deploy/deploy.sh deploy/setup-vm.sh
bash -n deploy/deploy.sh deploy/setup-vm.sh scripts/backup.sh scripts/restore.sh scripts/test-disaster-recovery.sh infra/backup/backup.sh infra/docker-exporter/script.sh
sh -n gateway/script.sh
```

Shell syntax checks do not establish correct runtime behavior. Show selected safe sections of the workflow and Compose file to connect the diagram to implementation.

## 4. Practical troubleshooting procedure

Use the same order consistently:

1. **Describe the symptom precisely.** Which URL, user action, response code, timestamp, and environment? Is everyone affected?
2. **Identify the layer.** DNS, TCP, TLS, gateway/WAF, application, inter-service dependency, database, or storage?
3. **Collect evidence.** Container state, focused logs, health endpoint, metrics, and a minimal request.
4. **Test one hypothesis.** For example, query the same upstream internally to distinguish gateway routing from application failure.
5. **Make the smallest justified correction.** Preserve data and record the change.
6. **Verify the original user action.** A successful restart is not the acceptance criterion.

For a 502, check upstream reachability and configuration. For a 504, investigate time spent waiting. For a 429, inspect the IP-based rate budget. For a 403, find whether Nginx, ModSecurity, or backend authorization generated it. Browser console errors alone rarely establish the root cause.

## 5. Experiments that need a disposable environment

Do not run these on shared data as casual demonstrations. Fixed container, network, and volume names mean a second Compose project name alone does not isolate a copy of this stack. Use a separate VM/Docker daemon or an audited configuration with unique names, volumes, ports, and backup paths.

### Recovery exercise

1. Set up disposable databases with users, rooms, memberships, messages, and an avatar.
2. Pause automated backup and application writes for the recovery exercise; preserve the intended snapshot pair outside the mutable latest paths.
3. Create a snapshot and record expected counts/relationships and start time.
4. On this disposable stack, run the existing marker test or simulate a controlled loss.
5. Restore the selected snapshot. Capture actual command exit statuses and database errors.
6. Verify login, rooms/memberships, message history, and avatar retrieval, not just marker records.
7. Record actual loss window and recovery duration. Expect existing coverage gaps to show up.

`make test-recovery` performs database restoration, not just insertion/deletion of temporary markers. Do not call it harmless because its initial test records are temporary.

### Failure and alert exercise

Use an isolated test receiver or disable external notification delivery before intentionally triggering failures; coordinate any test that would notify teammates.

1. Observe healthy targets and baseline metrics.
2. Stop one disposable application service.
3. Observe Docker state, Prometheus scrape failure, pending alert, and firing alert.
4. Restore the service and observe resolution.
5. Repeat with the exporter to understand the difference between a container failure and loss of visibility.

Record actual timestamps. Also test controlled CPU pressure after correcting the metric expression, and actual 5xx ratio behavior after correcting that rule. Do not run attack/load tests against the public deployment without a bounded, authorized test plan.

### Deployment exercise

On a test target, verify a known revision, deploy a harmless change, record the deployed SHA/image IDs, test HTTP and WebSockets, then practise returning to a known-good version. Include a failed-build scenario. This exposes whether the workflow actually propagates errors and whether rollback assumptions are valid.

## 6. A 12-minute interview demonstration

| Time | Show | Say |
| --- | --- | --- |
| 0–2 minutes | Architecture diagram and Compose service list | Explain boundaries, published ports, persistence, and one request |
| 2–4 minutes | Gateway config and HTTP/TLS result | Explain redirect, certificate, rewrite, and WebSocket upgrade |
| 4–6 minutes | Workflow jobs and remote deployment script | Explain checks, deploy gate, and missing immutable-artifact guarantee |
| 6–8 minutes | One exporter metric, query, and dashboard | Explain source, units, counter/gauge, and scrape freshness |
| 8–10 minutes | Backup script and pre-recorded disposable restore evidence | Explain coverage, RPO/RTO, and why a success message is insufficient |
| 10–12 minutes | Two prioritized findings | Explain a concrete correction and how you would verify it |

Choose two improvements you understand deeply—for example complete backup coverage and alert correctness. Avoid presenting an unprioritized list of every possible production feature.

## 7. Final self-check

- [ ] I can draw the stack and name each port without reading the diagram.
- [ ] I can explain `ports`, `expose`, `env_file`, volumes, and health dependencies.
- [ ] I can explain why a Docker restart is different from rebuilding/recreating.
- [ ] I can trace at least one API rewrite and the WebSocket handshake.
- [ ] I know where TLS ends and how certificate trust differs from encryption.
- [ ] I can explain which routes bypass ModSecurity and why backend authorization still matters.
- [ ] I can derive CPU/network rates and explain the current alert errors.
- [ ] I know what the exporter can and cannot observe from its container.
- [ ] I can explain every CI job and identify what is not tested.
- [ ] I can state the exact backup scope and restore failure risks.
- [ ] I can distinguish a configured feature from one I have demonstrated.
- [ ] I have inspected screenshots/logs before sharing to avoid exposing secrets or user data.
- [ ] I have one honest troubleshooting story: symptom → evidence → cause → fix → validation.

## 8. Further reading by question

Use these official references to resolve specific questions rather than memorizing unrelated cloud terminology:

- **When does Compose wait?** [Docker startup order](https://docs.docker.com/compose/how-tos/startup-order/).
- **What do service keys do?** [Compose service reference](https://docs.docker.com/reference/compose-file/services/).
- **Why is daemon access privileged?** [Docker Engine security](https://docs.docker.com/engine/security/).
- **How does header inheritance work?** [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
- **How is a WebSocket proxied?** [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html).
- **How do I derive rates?** [Prometheus functions](https://prometheus.io/docs/prometheus/latest/querying/functions/).
- **What does an alert hold duration mean?** [Prometheus alert rules](https://github.com/prometheus/prometheus/blob/main/docs/configuration/alerting_rules.md).
- **How do dashboards become reproducible?** [Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/).
- **What does a logical dump cover?** [PostgreSQL SQL dumps](https://www.postgresql.org/docs/18/backup-dump.html).

The repository is the source for project-specific behavior. Upstream references explain mechanisms; neither replaces verification of the actual deployed version and configuration.
