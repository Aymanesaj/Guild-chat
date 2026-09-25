ifeq ($(origin UID),undefined)
    export UID := $(shell id -u)
endif

DOCKER_SOCK := $(shell if [ -S /var/run/user/$$(id -u)/docker.sock ]; then \
	echo /var/run/user/$$(id -u)/docker.sock; \
	else echo /var/run/docker.sock; fi)

all: up

up: run
	DOCKER_SOCK=$(DOCKER_SOCK) docker compose up -d

build: run
	DOCKER_SOCK=$(DOCKER_SOCK) docker compose up --build -d

down:
	docker compose down

clean:
	docker compose down --remove-orphans

fclean:
	docker compose down -v --remove-orphans
	docker system prune -a

ps:
	@docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

restart:
	docker compose restart

re: clean build

logs:
	docker compose logs -f

run:
	@if [ ! -f .env ]; then \
		@echo "ERROR: .env file is missing! Please create it before running."; \
		@exit 1; \
	fi
	@echo "Starting the application..."

monitoring:
	docker compose down -v --remove-orphans grafana prometheus docker-exporter alertmanager
	docker compose up --build -d grafana prometheus docker-exporter alertmanager

microservices:
	docker compose down -v --remove-orphans chat-service identity-service org-service 
	docker compose up --build -d chat-service identity-service org-service 
proxy:
	docker compose down -v --remove-orphans nginx
	docker compose up --build -d nginx 

backup:
	@./scripts/backup.sh

restore:
	@./scripts/restore.sh $(SNAPSHOT)

test-recovery:
	@./scripts/test-disaster-recovery.sh

status:
	@curl -k -s https://localhost:8443/api/v1/endpoints/statuses | jq '.[] | {name: .name, group: .group, status: (if .results[-1].success then "HEALTHY" else "UNHEALTHY" end), duration_ms: (.results[-1].duration / 1000000)}' 2>/dev/null || echo "Open https://localhost:8443/status/ in browser."
	@STATUS_USER=$$(grep -E '^STATUS_PAGE_USER=' .env 2>/dev/null | cut -d= -f2); \
	STATUS_PASS=$$(grep -E '^STATUS_PAGE_PASSWORD=' .env 2>/dev/null | cut -d= -f2); \
	AUTH_FLAG=""; \
	if [ -n "$$STATUS_USER" ] && [ -n "$$STATUS_PASS" ]; then \
		AUTH_FLAG="-u $$STATUS_USER:$$STATUS_PASS"; \
	fi; \
	curl -k -s $$AUTH_FLAG https://localhost:8443/api/v1/endpoints/statuses | jq '.[] | {name: .name, group: .group, status: (if .results[-1].success then "HEALTHY" else "UNHEALTHY" end), duration_ms: (.results[-1].duration / 1000000)}' 2>/dev/null || echo "Open https://localhost:8443/status/ in browser."

