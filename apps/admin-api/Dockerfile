FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json nx.json tsconfig.base.json ./
RUN npm ci --legacy-peer-deps
COPY apps/admin-api/ apps/admin-api/
RUN NX_NO_CLOUD=true npx nx build admin-api --configuration=production

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist/apps/admin-api .
# migrate.js is compiled alongside main.js by nx build
RUN npm ci --omit=dev --legacy-peer-deps
EXPOSE 3000
CMD ["node", "main.js"]
