FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json nx.json tsconfig.base.json ./
RUN npm ci
COPY apps/landing/ apps/landing/
RUN NX_NO_CLOUD=true npx nx build landing

FROM nginx:alpine
COPY --from=builder /app/dist/apps/landing /usr/share/nginx/html
COPY apps/landing/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
