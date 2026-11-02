# The web app as a standalone Next.js server. NEXT_PUBLIC_* vars are inlined
# into the client bundle at build time, so pass them as build args:
#   docker build -f packages/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_WS_URL=wss://cp.example.com .

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --include-workspace-root \
      --workspace=@open-inspect/shared --workspace=@open-inspect/web
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/

ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_ICON_URL
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
    NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME} \
    NEXT_PUBLIC_APP_ICON_URL=${NEXT_PUBLIC_APP_ICON_URL}

RUN npm run build -w @open-inspect/shared \
    && npm run build -w @open-inspect/web

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/web/.next/standalone/packages/web ./packages/web
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build /app/packages/web/public ./packages/web/public
CMD ["node", "packages/web/server.js"]
