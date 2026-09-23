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
	docker compose down -v --remove-orphans

fclean:
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
	docker compose down -v --remove-orphans grafana prometheus docker-exporter alertmanager loki promtail
	docker compose up --build -d grafana prometheus docker-exporter alertmanager loki promtail

microservices:
	docker compose down -v --remove-orphans chat-service identity-service org-service 
	docker compose up --build -d chat-service identity-service org-service 
proxy:
	docker compose down -v --remove-orphans nginx
	docker compose up --build -d nginx 

backup:
	@./scripts/backup.sh

restore:
	@./scripts/restore.sh

status:
	@curl -k -s https://localhost:8443/api/v1/endpoints/statuses | jq '.[] | {name: .name, group: .group, status: (if .results[-1].success then "HEALTHY" else "UNHEALTHY" end), duration_ms: (.results[-1].duration / 1000000)}' 2>/dev/null || echo "Open https://localhost:8443/status/ in browser."
