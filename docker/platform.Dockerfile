FROM node:22.22.3-slim AS builder

RUN corepack enable && corepack prepare pnpm@11.13.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/platform ./apps/platform
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @offisim/platform... build

FROM node:22.22.3-slim

RUN corepack enable && corepack prepare pnpm@11.13.0 --activate

WORKDIR /app

COPY --from=builder /app /app

ENV NODE_ENV=production

EXPOSE 4100

CMD ["node", "apps/platform/dist/index.js"]
