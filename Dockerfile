FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS frontend-build
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS backend-deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev \
  && npm rebuild nodejieba --build-from-source \
  && npm cache clean --force

FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
WORKDIR /app

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=backend-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server/ ./server/
COPY game_config_v0.1/ ./game_config_v0.1/
COPY data/ ./data/
COPY legal/ ./legal/
COPY legacy/ ./legacy/
COPY client/public/ ./client/public/
COPY --from=frontend-build /app/client/dist ./client/dist
COPY engine.js ./engine.js
COPY server.js ./server.js
COPY index.html ./index.html
COPY round1.html ./round1.html
COPY round2.html ./round2.html

EXPOSE 3000

CMD ["node", "server.js"]
