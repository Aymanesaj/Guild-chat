ifeq ($(origin UID),undefined)
    export UID := $(shell id -u)
endif

all: up

up: run
	docker compose up -d

build: run
	docker compose up --build -d

down:
	docker compose down

clean:
	docker compose down -v --remove-orphans

fclean:
	docker system prune -a

restart:
	docker compose restart

re: clean build

logs:
	docker compose logs -f

ps:
	docker compose ps

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