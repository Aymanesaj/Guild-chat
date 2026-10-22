FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
COPY proto ./proto

# Prisma loads the URL from its config without connecting during generation.
RUN MEDIA_DATABASE_URL=postgresql://build:build@localhost:5432/build npm run db:generate
RUN npm run build

FROM build AS migration
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/proto ./proto

USER node
EXPOSE 8084
CMD ["node", "dist/server.js"]
