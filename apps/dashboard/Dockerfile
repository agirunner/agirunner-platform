FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_PLATFORM_API_URL=http://localhost:8080
ARG VITE_DASHBOARD_LOGIN_PREFILL_KEY=
ENV VITE_PLATFORM_API_URL=${VITE_PLATFORM_API_URL}
ENV VITE_DASHBOARD_LOGIN_PREFILL_KEY=${VITE_DASHBOARD_LOGIN_PREFILL_KEY}
RUN pnpm --filter @agirunner/dashboard build

FROM nginx:1.27-alpine AS runtime
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
