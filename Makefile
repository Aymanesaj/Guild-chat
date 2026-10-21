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

.PHONY: logs-app logs-microservices logs-proxy

logs-app:
	docker compose --ansi always logs -f chat-service identity-service org-service media-service nginx

logs-microservices:
	docker compose --ansi always logs -f chat-service identity-service org-service media-service

logs-proxy:
	docker compose --ansi always logs -f nginx

run:
	@if [ ! -f .env ]; then \
		echo "ERROR: .env file is missing! Please create it before running."; \
		exit 1; \
	fi
	@echo "Starting the application..."

monitoring: run
	DOCKER_SOCK=$(DOCKER_SOCK) docker compose up --build -d grafana prometheus docker-exporter alertmanager

microservices: run
	DOCKER_SOCK=$(DOCKER_SOCK) docker compose up --build -d chat-service identity-service org-service media-service

proxy: run
	DOCKER_SOCK=$(DOCKER_SOCK) docker compose up --build -d nginx

backup:
	@./databases/backup-recovery/scripts/backup.sh

restore:
	@./databases/backup-recovery/scripts/restore.sh $(SNAPSHOT)

test-recovery:
	@./databases/backup-recovery/scripts/test-disaster-recovery.sh

status:
	@STATUS_USER=$$(grep -E '^STATUS_PAGE_USER=' .env 2>/dev/null | cut -d= -f2-); \
	STATUS_PASS=$$(grep -E '^STATUS_PAGE_PASSWORD=' .env 2>/dev/null | cut -d= -f2-); \
	set --; \
	if [ -n "$$STATUS_USER" ] && [ -n "$$STATUS_PASS" ]; then \
		set -- --user "$$STATUS_USER:$$STATUS_PASS"; \
	fi; \
	STATUS_JSON=$$(curl -kfsS "$$@" --resolve status.localhost:443:127.0.0.1 https://status.localhost/api/v1/endpoints/statuses) || { \
		echo "Could not fetch status. Check credentials or open https://status.localhost/ in your browser." >&2; \
		exit 1; \
	}; \
	printf '%s\n' "$$STATUS_JSON" | jq '.[] | {name: .name, group: .group, status: (if .results[-1].success then "HEALTHY" else "UNHEALTHY" end), duration_ms: (.results[-1].duration / 1000000)}'
