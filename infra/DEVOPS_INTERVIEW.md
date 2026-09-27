# DevOps mock interview: questions and answer outlines

Companion to [the implementation guide](DEVOPS_GUIDE.md). These answers describe the reviewed project, including its limitations. Practise the ideas in your own words. Avoid claiming measured performance, successful production drills, or security guarantees without evidence.

## 1. A two-minute opening

> Our application has a React frontend and three Spring services: identity, organization, and chat. My responsibility is the infrastructure around them. Docker Compose defines the services, dependencies, network, storage, and runtime configuration. Only the Nginx gateway publishes application ports. It terminates HTTPS, routes API and WebSocket traffic, and applies ModSecurity and API rate limits.
>
> Identity and organization use separate databases in one PostgreSQL instance; chat uses MongoDB. Named volumes preserve database data and avatars across container recreation. I use multi-stage image builds to separate build dependencies from runtime, and the Java services run as non-root users with a custom Java runtime.
>
> For observability, Prometheus scrapes application metrics, a custom Docker/system/PostgreSQL exporter, and an Nginx exporter. Grafana displays them, Alertmanager routes alerts, and Gatus checks internal availability. GitHub Actions runs frontend checks, backend tests, and Compose validation before deployment over SSH to our VM.
>
> I also implemented logical database dumps and restore scripts. The current system is a single-host deployment, with known improvements needed around complete backup coverage, reliable restore failure handling, alert correctness, and deploying immutable tested artifacts.

Then stop. Let staff choose what to explore rather than rushing through every tool name.

## 2. Architecture and Linux fundamentals

### 1. Why use containers rather than install everything on the VM?

Containers package dependencies and let each service have a repeatable runtime. Compose records how the pieces connect. This reduces environment drift, but the host kernel, CPU architecture, external credentials, and persistent data remain dependencies. Containers do not eliminate operations work.

**Follow-up:** Containers share the host kernel; VMs normally run their own guest kernel. Namespaces isolate resource views; cgroups account for and constrain resources.

### 2. Why Compose instead of Kubernetes?

We have a single-host project and Compose expresses its requirements with less operational complexity. Kubernetes would introduce scheduling, services, rollout controllers, and cluster operations. We should introduce those when their benefits justify the complexity. This deployment does not provide multi-node failover or orchestration-based self-healing.

### 3. What happens if the VM dies?

The application and its local monitoring stop. Named volumes do not survive loss of the underlying host storage, and backups on that host share the failure domain. Recovery needs independent backups, configuration, certificates/secrets, and a replacement host. We have not implemented that complete host-loss recovery path.

### 4. Why can several containers listen on port 9090?

Each has its own network namespace and IP. A port conflict occurs when processes bind the same address/port in the same network namespace or when two host publications compete for the same host endpoint.

### 5. How does chat find identity?

It connects to Docker's service name `identity-service` on internal port 9090 using gRPC. Docker networking supplies name resolution. `localhost` would point back to the chat container and would be wrong for this connection.

### 6. What is the difference between a process being running, live, and ready?

A running process exists. Liveness asks whether it can still make progress. Readiness asks whether it can serve the traffic we intend to send. Our probes vary in strength: organization `/healthz` returns a constant `OK`, whereas Actuator can include configured health contributors. None of these alone proves a full login-and-chat user flow.

### 7. Why does `exec` matter in a startup script?

It replaces the shell rather than leaving it as a parent process. This helps the real server receive termination signals. Graceful shutdown matters for in-flight requests and database connections. The gateway ultimately launches Nginx in the foreground.

## 3. Docker builds, storage, and permissions

### 8. Explain your multi-stage build.

The build stage has the toolchain and dependencies needed to compile. The runtime stage gets only the compiled output and runtime requirements. Frontend uses Node to build and Nginx to serve. Java services compile with Maven and copy a custom Java runtime plus the JAR into Alpine.

**Follow-up:** Multi-stage builds can reduce the final contents; they do not automatically guarantee small or secure images. Measure size, review contents, scan dependencies, and test the runtime.

### 9. What is build cache invalidation?

Changing a layer's inputs forces that step and dependent later steps to rebuild. Copying the dependency manifest before application source lets unchanged dependencies reuse earlier layers. Chat's current Dockerfile provides less separation here than identity/organization.

### 10. What does `jlink` do, and how can it break the application?

It builds a Java runtime from selected modules. It removes unneeded runtime components but creates an obligation to include everything the application needs. A feature using a missing module can fail at runtime. Test features that exercise TLS, database drivers, reflection-dependent libraries, and other less frequent code paths.

### 11. Does `EXPOSE` make a port public?

No. Dockerfile `EXPOSE` and Compose `expose` describe container ports. Compose `ports` publishes a host mapping. A sibling container on the network may reach a listening port even if it is not listed in `expose`.

### 12. What survives a container rebuild?

Named-volume and bind-mounted data survive ordinary recreation. Changes only in the container writable layer should be treated as disposable. In our project, avatars survive because their directory is mounted, despite being under `/tmp`.

### 13. What is the difference between a bind mount and a named volume?

A bind mount points to a chosen host path, such as `./certs` or `./backups`. Docker manages the storage location of a named volume, such as `database`. Both require permission management and backup planning; neither is a backup by itself.

### 14. Does `restart: always` restart unhealthy containers?

Not simply because the health label changes. It handles container exits according to restart-policy rules. A process that hangs while staying alive may remain unhealthy. We need detection plus an explicit recovery strategy.

### 15. Why run as non-root?

It reduces privileges available to a compromised application inside the container. It complements file ownership, capabilities, host protections, and network restrictions. It does not make a container invulnerable, and not all our images explicitly configure non-root execution.

### 16. Why is a read-only Docker socket mount still dangerous?

The socket carries requests to the Docker daemon. Filesystem read-only mounting does not restrict which API requests a process can send through it. A compromised exporter with daemon access can have much greater impact than an ordinary application container. An API-filtering proxy and strict access controls are possible improvements.

## 4. Networking, TLS, and application security

### 17. Explain reverse proxy versus forward proxy.

A reverse proxy represents servers to clients; our gateway receives requests and selects internal services. A forward proxy represents clients when reaching other servers. Our gateway centralizes TLS and public routing.

### 18. Trace a request through your route rewrite.

For `/api/users/login`, the gateway selects the identity location, removes `/api/users/`, and forwards `/login` to `identity-service:8083`. The controller must accept the rewritten path. For `/ws/chat`, the path is preserved and upgrade headers are forwarded.

### 19. Where does encryption stop?

At the gateway. Browser traffic is HTTPS/WSS; internal HTTP and reviewed gRPC connections are plaintext on the shared network. Network isolation and encryption are different controls. Mutual TLS would additionally authenticate and encrypt internal service connections.

### 20. What does a certificate prove?

With a valid trusted chain, hostname match, and validity period, it binds a public key to the server identity. The private key proves possession during TLS. A self-signed certificate can support encryption but is not automatically trusted by the browser.

### 21. How do your certificates renew?

The repository documents manual Certbot issuance and copying certificate files. The gateway copies mounted files at startup. There is no implemented renewal-copy-reload automation, so renewal of Certbot's originals alone is insufficient. I would add and test that lifecycle rather than claim renewal is already automatic.

### 22. What makes WebSockets different from REST?

REST calls normally use request/response exchanges. A WebSocket starts with an HTTP upgrade and then supports bidirectional messages over a persistent connection. The gateway must preserve the upgrade semantics, and the application must authenticate, authorize subscriptions, and handle reconnects. A deployment restart disconnects active sockets.

### 23. What does ModSecurity protect against?

It inspects HTTP requests using configured rules, including CRS attack patterns. It is a defense layer, not a replacement for input validation, safe database access, or authorization. We deliberately exclude certain routes, including WebSockets, so protection is not uniform.

### 24. Detection-only versus blocking mode?

Detection-only records rule matches without enforcing a block. Blocking mode can reject requests according to the rule configuration. Our gateway's explicit configuration selects blocking; the template `.env` value is not the effective gateway setting. False positives need investigation and narrow exceptions.

### 25. Why allow PATCH and DELETE through the WAF?

They support legitimate editing and deletion APIs. Blocking all such methods would break required application behavior. Allowing an HTTP method does not authorize its business action: the backend still checks the user and their permissions.

### 26. How does your rate limit work?

The selected API locations share a client-IP keyed zone at 20 requests/second with a burst allowance of 30, accepted without deliberate delay, and 429 for excess. Shared NAT addresses can cause multiple users to share a budget. It is not a per-user limit and does not govern WebSocket messages.

### 27. Is the network named `private` actually private?

Only publishing the gateway avoids directly publishing other service ports. But all services share the network, and its name does not enable encryption, fine-grained segmentation, or disable internet egress. Those would require additional configuration.

### 28. Are you using Vault and centralized logs?

No active Vault or Loki service is defined in the reviewed Compose stack. The Vault config file is empty. We use environment-based configuration, Docker logs, metrics, dashboards, and alerts. I distinguish planned modules from implemented ones.

## 5. Monitoring and PromQL

### 29. Prometheus versus Grafana versus Alertmanager?

Prometheus scrapes and stores metrics and evaluates alert expressions. Grafana queries data to visualize it. Alertmanager groups/routes notifications and manages notification timing. Gatus performs separate endpoint probes.

### 30. What does `up == 0` mean?

A configured Prometheus target could not be scraped successfully. It may be down, unreachable, returning an error, or exposing invalid metrics. It does not identify the root cause, and `up == 1` does not prove business functionality.

### 31. Counter versus gauge?

A counter accumulates events/quantity and may reset, so a rate is usually meaningful. A gauge is a current value that can move both ways. Network bytes and CPU time accumulate; memory usage is a gauge. Plotting cumulative CPU time directly does not show current CPU utilization.

### 32. Why can CPU exceed 100%?

If 100% means one fully used core, using two cores can approach 200%. To show a fraction of total machine capacity, normalize by available cores or the appropriate system CPU-time rate. State the denominator before interpreting the number.

### 33. Is your 5xx alert really a 5% error ratio?

No. Its current expression checks a per-series rate greater than 0.05 errors/second. A ratio needs total 5xx throughput divided by total request throughput over the same window and aggregation. The alert description overstates what the expression means.

### 34. Why might the CPU alert never fire?

It references `container_cpu_usage_percentage`, which our exporter does not emit and our rules do not record. A missing series is not the same as a measured healthy zero. Derive the expression from our CPU-time counter and verify it under controlled load.

### 35. How does the exporter avoid partially written metrics?

It finishes a temporary file, copies it to a hidden file in the served directory, then renames it into place. Scrapes see either the previous complete file or the new complete file. This does not guarantee freshness if collection stops.

### 36. Are the exporter metrics all host metrics?

No. Collection runs inside a container. Some kernel values may reflect host information, while network interfaces and mount visibility depend on namespaces. Optional hardware sensors may not exist. The disk collector also needs corrections. I would inspect each source rather than infer host coverage from a `node_` prefix.

### 37. How quickly will an alert arrive?

After the condition becomes observable, scraping, rule evaluation, the rule's `for` duration, Alertmanager grouping delay, and receiver delivery all contribute. Our microservice scrapes are 10 seconds, rule evaluations 15 seconds, the down alert holds for 30 seconds, and Alertmanager initially waits 10 seconds. I would measure delivery rather than promise an exact sum.

### 38. What if Prometheus itself fails?

Grafana cannot retrieve fresh samples, and Prometheus cannot evaluate/send new alerts. Self-scraping does not solve this: a failed monitoring system cannot reliably report its own failure. Independent external availability checks or a dead-man signal would reduce that blind spot.

## 6. CI/CD and operations

### 39. What is CI, continuous delivery, and continuous deployment?

CI integrates changes with automated checks. Continuous delivery keeps a release deployable, potentially with a manual production gate. Continuous deployment automatically deploys passing changes. Our push-to-main workflow implements an automatic deployment path after its checks.

### 40. What exactly does CI test?

Frontend lint/build, three Maven test jobs, and Compose configuration validation. Chat uses real containerized MongoDB in relevant tests; identity and organization test configurations use H2. It does not exercise the whole production stack, real TLS routing, or image builds.

### 41. Why use a matrix and `fail-fast: false`?

The matrix applies the same test workflow to three service directories. Independent jobs give separate failure reports. Disabling fail-fast keeps other matrix jobs running so one failure does not hide the others' results.

### 42. Do you deploy exactly what CI tested?

Not with a strict immutable-artifact guarantee. The VM fetches current `main` and rebuilds locally. The branch can advance and floating dependencies/build environments can differ. I would build once in CI, tag by commit, push an immutable image, and deploy that digest.

### 43. Why restart Nginx after deployment?

It reruns startup processing and refreshes upstream resolution after recreated containers may change addresses. It also refreshes copied certificates. It can interrupt traffic and WebSockets; a more controlled deployment should handle resolution/readiness and use graceful operations where appropriate.

### 44. How do you roll back?

There is no automatic rollback implemented. A robust process would deploy a known-good artifact and verify it, while accounting for database schema compatibility. Rolling application code back alone may be unsafe after a schema/data change. Current Hibernate `ddl-auto=update` is not a versioned migration/rollback plan.

### 45. Why is an SSH private key sensitive?

It authenticates access to the VM as the deployment account. Permissions available to that account determine its impact; Docker access can be very powerful. GitHub secrets keep the key out of normal repository files. Host fingerprint verification and least privilege are additional controls.

## 7. Backup and reliability

### 46. Why are persistent volumes not backups?

They survive container recreation but remain the live data. Accidental deletion, corruption, or host loss can destroy them. A backup needs an independent recoverable copy and a tested restoration procedure.

### 47. What exactly does your backup cover?

One configured PostgreSQL database, normally `transdb`, and a MongoDB archive without an explicit DB restriction. It does not cover `org_service_db`, avatar files, or complete host/application configuration. Fixing that coverage is a priority before claiming full recovery.

### 48. RPO versus RTO?

RPO is how much data loss over time we can accept; RTO is how long restoration may take. The automatic interval is 12 hours plus execution time, but failures can increase backup age. We must measure restore time and define acceptable targets with the team.

### 49. Is restoring a timestamped file point-in-time recovery?

It selects a snapshot. PostgreSQL PITR would use a base backup and transaction log replay to reach a chosen point beyond the base snapshot. Our scripts implement logical dump restoration, not that system.

### 50. How can the restore script report success incorrectly?

MongoDB restore errors are explicitly ignored with `|| true`, and PostgreSQL restoration does not set `ON_ERROR_STOP`. A shell exit code and a success message are therefore insufficient evidence. Verify expected records, relationships, and actual application flows.

### 51. What does your recovery test prove?

If it passes, the PostgreSQL and MongoDB marker records were recovered through that run's backup/restore path. It does not prove coverage for the organization database, files, all business relationships, or total host loss. It restores database contents, so it belongs on a disposable environment.

### 52. Are independently dumped databases mutually consistent?

Not necessarily. Each dump has its own timing while cross-service operations can continue. A room created in PostgreSQL and a message written to MongoDB may fall on opposite sides of the snapshots. We need a recovery consistency strategy, such as a coordinated quiet period and validation of references.

## 8. Troubleshooting questions staff may ask

| Scenario | Explain your first steps |
| --- | --- |
| Browser shows 502 | Identify route, inspect gateway logs, resolve upstream name, test its internal listener, then inspect service health/logs |
| Browser shows 504 | Inspect upstream latency, resource pressure, slow DB queries, and gRPC deadlines; don't merely increase timeouts |
| Backend is healthy but gateway won't start | Inspect every declared gateway dependency, including Grafana and exporter; check Nginx config and certificates |
| Login works but chat does not | Separate REST from WebSocket handshake, inspect authentication and membership gRPC calls, subscription state, MongoDB, and reconnect behavior |
| 403 after WAF change | Distinguish ModSecurity rejection, Nginx IP denial, and backend authorization; inspect the rejecting layer's logs |
| Prometheus has data but Grafana is empty | Check datasource UID/URL, dashboard provisioning, time range, labels, and actual emitted metric names |
| Site works locally but not publicly | Check DNS, public IP, cloud rules, host/Docker forwarding, published ports, listener, and certificate |
| Password changed in `.env`, database login fails | Existing database volumes retain initialized credentials; inspect/rotate DB roles through an intentional operation |
| Container repeatedly restarts | Inspect exit status, OOM state, logs, resource pressure, and dependency failures; preserve evidence before restarting again |
| Restore says success but data is missing | Check actual archive scope, timestamps, database selection, hidden errors, record counts, and app-level behavior |

## 9. How to answer when you don't know

Use a specific verification plan: “I know the gateway publishes 443 and proxies to 8083. I haven't verified whether the failure is TLS or the upstream yet. I would inspect the handshake, then the gateway error log, then query the internal endpoint.”

Separate **implemented**, **observed**, and **proposed**. For example: “The configuration defines a Discord receiver; I still need to verify delivery in a controlled rehearsal.” This is stronger than guessing that configuration proves successful operation.

## 10. Readiness score

For each topic, give yourself 0–3:

- **0:** I recognize the name only.
- **1:** I can explain its purpose.
- **2:** I can trace the actual code/configuration and explain a tradeoff.
- **3:** I can demonstrate it, diagnose a failure, and state its limits.

Aim for 3 on gateway routing, Compose, CI/CD, monitoring, and backup/restore. Practise with the [rehearsal checklist](DEVOPS_REHEARSAL.md), then have a teammate ask follow-ups without showing you these answers.
