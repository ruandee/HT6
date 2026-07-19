# app-services for Cloud Run. See DEPLOY_CHECKLIST.md §8.
#
# Multi-stage: the build stage needs the whole workspace (npm ci validates the lockfile against
# every package listed in the root `workspaces` field, so the frontend package.json files have to
# be present even though we never build them). The runtime stage carries only the three server
# packages' compiled output plus the pruned dependency tree.
FROM node:22-slim AS build
WORKDIR /app

# tsconfig.base.json is NOT optional: every package extends ../../tsconfig.base.json, and without
# it tsc silently falls back to target ES5 with no ES2022 lib — which fails the build on
# Map iteration and Error.cause rather than on anything real.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages

RUN npm ci
RUN npm run build \
  --workspace @ttr/shared-types \
  --workspace @ttr/chain-services \
  --workspace @ttr/app-services
# drop typescript and friends now that the JS exists
RUN npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# non-root: Cloud Run does not require it, but there is no reason to run the demo as root
USER node

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=build --chown=node:node /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build --chown=node:node /app/packages/chain-services/package.json ./packages/chain-services/
COPY --from=build --chown=node:node /app/packages/chain-services/dist ./packages/chain-services/dist
COPY --from=build --chown=node:node /app/packages/app-services/package.json ./packages/app-services/
COPY --from=build --chown=node:node /app/packages/app-services/dist ./packages/app-services/dist

# Cloud Run injects PORT (8080 by default) and health-checks that exact port; config.ts reads it
# first, falling back to APP_SERVICES_PORT for local dev.
EXPOSE 8080
CMD ["node", "packages/app-services/dist/server.js"]
