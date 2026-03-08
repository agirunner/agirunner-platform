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
RUN pnpm --filter @agirunner/platform-api build
RUN mkdir -p apps/platform-api/dist/src/db/migrations apps/platform-api/dist/configs \
  && cp apps/platform-api/src/db/migrations/*.sql apps/platform-api/dist/src/db/migrations/ \
  && cp apps/platform-api/configs/built-in-roles.json apps/platform-api/dist/configs/
RUN pnpm --filter @agirunner/platform-api deploy --legacy /app --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_URL=
ENV JWT_SECRET=
ENV WEBHOOK_ENCRYPTION_KEY=
COPY --from=build /app ./
USER node
EXPOSE 8080
CMD ["node", "dist/src/index.js"]
