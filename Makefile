COMPOSE := docker compose -f infra/docker-compose.yml
PSQL := $(COMPOSE) exec postgres psql -U chatcrdt -d chatcrdt

.PHONY: help up down restart logs ps psql redis migrate studio dev server clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Start infra (postgres + redis) detached
	$(COMPOSE) up -d

down: ## Stop infra
	$(COMPOSE) down

restart: down up ## Restart infra

logs: ## Tail infra logs
	$(COMPOSE) logs -f

ps: ## Show infra container status
	$(COMPOSE) ps

psql: ## Open psql shell on postgres
	$(PSQL)

query: ## Run one-off SQL: make query Q="SELECT * FROM \"User\" LIMIT 5"
	$(PSQL) -c "$(Q)"

redis: ## Open redis-cli shell
	$(COMPOSE) exec redis redis-cli

migrate: ## Run prisma migrations (server)
	cd apps/server && bun prisma migrate dev

studio: ## Open prisma studio (server)
	cd apps/server && bun prisma studio

server: ## Run server in watch mode
	cd apps/server && bun dev

dev: up ## Start infra then run server (everything)
	cd apps/server && bun dev

clean: ## Stop infra and wipe volumes (DESTRUCTIVE)
	$(COMPOSE) down -v
