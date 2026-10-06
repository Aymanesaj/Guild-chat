FROM node:lts-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci

COPY . .

# Prisma generation needs a URL in its config but does not connect to a database.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build
RUN npm prune --omit=dev

FROM node:lts-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Include application-owned runtime assets such as Prisma and protobuf files.
COPY --from=build --chown=node:node /usr/src/app ./
RUN mkdir -p /tmp/identity-avatars && chown node:node /tmp/identity-avatars

USER node
EXPOSE 8083 9090

CMD ["npm", "start"]
