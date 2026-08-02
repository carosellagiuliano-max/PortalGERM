FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates=20230311+deb12u1 \
    openssl=3.0.20-1~deb12u2 \
  && rm -rf /var/lib/apt/lists/*
RUN install -d -o node -g node -m 0700 /phase33/document-vault /phase33/privacy-export
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci

FROM dependencies AS builder
ARG APP_BUILD_ID=phase33-contract-build
ENV APP_BUILD_ID=${APP_BUILD_ID}
ENV PHASE33_STANDALONE_BUILD=true
COPY . .
RUN npm run phase33:bundle
RUN npm run build

FROM dependencies AS migrator
COPY . .
RUN npm run db:generate
USER node
ENTRYPOINT ["npm", "run"]
CMD ["db:migrate"]

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS production-dependencies
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS app
ARG APP_BUILD_ID=phase33-contract-build
LABEL org.opencontainers.image.source="https://github.com/carosellagiuliano-max/PortalGERM"
LABEL org.opencontainers.image.revision=${APP_BUILD_ID}
LABEL org.opencontainers.image.version="phase33"
WORKDIR /app
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates=20230311+deb12u1 \
    openssl=3.0.20-1~deb12u2 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/dist/phase33/runtime-preflight.mjs ./dist/phase33/runtime-preflight.mjs
COPY --chmod=0555 docker/app-entrypoint.sh /usr/local/bin/phase33-app-entrypoint
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=4s --start-period=30s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health/ready',{signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/local/bin/phase33-app-entrypoint"]

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS phase33-runtime
ARG APP_BUILD_ID=phase33-contract-build
LABEL org.opencontainers.image.source="https://github.com/carosellagiuliano-max/PortalGERM"
LABEL org.opencontainers.image.revision=${APP_BUILD_ID}
LABEL org.opencontainers.image.version="phase33"
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates=20230311+deb12u1 \
    openssl=3.0.20-1~deb12u2 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist/phase33/runtime.mjs ./dist/phase33/runtime.mjs
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=4s --start-period=20s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health/ready',{signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

FROM phase33-runtime AS worker
ENTRYPOINT ["node", "--conditions=react-server", "dist/phase33/runtime.mjs"]
CMD ["--role=worker", "--health-port=3001", "--poll-ms=1000"]

FROM phase33-runtime AS scheduler
ENTRYPOINT ["node", "--conditions=react-server", "dist/phase33/runtime.mjs"]
CMD ["--role=scheduler", "--health-port=3001", "--poll-ms=1000"]

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS provider-contract
ARG APP_BUILD_ID=phase33-contract-build
LABEL org.opencontainers.image.source="https://github.com/carosellagiuliano-max/PortalGERM"
LABEL org.opencontainers.image.revision=${APP_BUILD_ID}
LABEL org.opencontainers.image.version="phase33-contract-only"
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=builder --chown=node:node /app/dist/phase33/provider-contract-stub.mjs ./provider-contract-stub.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/ready',{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["node", "provider-contract-stub.mjs"]
