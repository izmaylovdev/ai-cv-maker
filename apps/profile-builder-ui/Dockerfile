FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json nx.json tsconfig.base.json ./
RUN npm ci
COPY apps/profile-builder-ui/ apps/profile-builder-ui/
COPY libs/ libs/
RUN NX_NO_CLOUD=true npx nx build profile-builder-ui

FROM nginx:alpine
COPY --from=builder /app/dist/apps/profile-builder-ui /usr/share/nginx/html
COPY apps/profile-builder-ui/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
