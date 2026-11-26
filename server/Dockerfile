# OxEye Logistics Manager API. Build from the repository root so shared/ is
# available:  docker build -f server/Dockerfile -t oxeye-logistics-api .
# Node 26 runs the TypeScript sources directly; there is no build step.
FROM node:26-slim

ENV NODE_ENV=production
WORKDIR /app/server

# Runtime dependencies only (PGlite and test tooling stay out).
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/src ./src
COPY server/migrations ./migrations
COPY shared/logistics /app/shared/logistics

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "src/main.ts"]
