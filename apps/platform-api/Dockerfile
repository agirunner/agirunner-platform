FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/platform-api/package.json apps/platform-api/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @agentbaton/platform-api build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/platform-api/dist ./dist
COPY --from=build /workspace/apps/platform-api/package.json ./package.json
EXPOSE 8080
CMD ["node", "dist/index.js"]
