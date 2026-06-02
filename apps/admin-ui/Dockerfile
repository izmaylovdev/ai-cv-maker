FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json nx.json tsconfig.base.json eslint.config.mjs ./
RUN npm ci --legacy-peer-deps
COPY apps/admin-ui/ apps/admin-ui/
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
RUN NX_NO_CLOUD=true npx nx build admin-ui --configuration=production

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/apps/admin-ui/.next/standalone ./
COPY --from=builder /app/apps/admin-ui/.next/static ./apps/admin-ui/.next/static
COPY --from=builder /app/apps/admin-ui/public ./apps/admin-ui/public
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/admin-ui/server.js"]
