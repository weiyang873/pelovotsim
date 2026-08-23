ARG HF_EMBEDDING_MODEL_REVISION=2c4055b12046f11709e9df2c122e59ffbdc2f900

FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS frontend-build
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS backend-deps
WORKDIR /app
ARG HF_EMBEDDING_MODEL_REVISION
ENV HF_CACHE_DIR=/app/.cache/huggingface
ENV HF_EMBEDDING_MODEL_REVISION=$HF_EMBEDDING_MODEL_REVISION
ENV HF_EMBEDDING_EXPECTED_ONNX_SHA256=66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc
ENV HF_EMBEDDING_EXPECTED_TOKENIZER_SHA256=b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev \
  && npm rebuild nodejieba --build-from-source \
  && npm cache clean --force

COPY game_config_v0.1/llm_models.json ./game_config_v0.1/llm_models.json
COPY server/llm/modelRegistry.js ./server/llm/modelRegistry.js
COPY scripts/cache_embedding_model.js ./scripts/cache_embedding_model.js
RUN node scripts/cache_embedding_model.js

FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
WORKDIR /app

ARG GIT_COMMIT=unknown
ARG HF_EMBEDDING_MODEL_REVISION
ENV GIT_COMMIT=$GIT_COMMIT
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV HF_CACHE_DIR=/app/.cache/huggingface
ENV HF_EMBEDDING_MODEL_REVISION=$HF_EMBEDDING_MODEL_REVISION
ENV HF_DISABLE_REMOTE=1

COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-deps /app/.cache/huggingface /app/.cache/huggingface
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
