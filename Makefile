ifeq ($(origin UID),undefined)
    export UID := $(shell id -u)
endif

all: up

up:
	docker compose up -d

build:
	docker compose up --build -d

down:
	docker compose down

clean:
	docker compose down -v --remove-orphans

fclean:
	docker system prune

restart:
	docker compose restart

re: clean build

logs:
	docker compose logs -f

ps:
	docker compose ps