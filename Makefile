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