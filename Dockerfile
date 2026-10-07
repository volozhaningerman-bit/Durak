FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/game-core/package.json packages/game-core/package.json

RUN npm install

COPY . .

# The Telegram Mini App frontend is deployed separately as a static CDN site.
# The backend image only builds the authoritative game engine and server.
# Avoiding the Vite/Rollup frontend build here also removes Alpine/musl
# optional-native dependency flakiness from production server builds.
RUN npm run build -w @durak/game-core \
  && npm run build -w @durak/server \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["npm", "start"]
