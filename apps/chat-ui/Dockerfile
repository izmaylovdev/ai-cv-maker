FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json nx.json tsconfig.base.json ./
RUN npm ci
COPY apps/chat-ui/ apps/chat-ui/
COPY libs/ libs/
RUN NX_NO_CLOUD=true npx nx build chat-ui

FROM nginx:alpine
COPY --from=builder /app/dist/apps/chat-ui /usr/share/nginx/html
COPY apps/chat-ui/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
