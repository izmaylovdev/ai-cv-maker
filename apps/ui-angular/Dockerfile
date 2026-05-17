FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json nx.json .postcssrc.json tsconfig.base.json ./
RUN npm ci
COPY apps/ui-angular/ apps/ui-angular/
RUN NX_NO_CLOUD=true npx nx build ui-angular --configuration=production

FROM nginx:alpine
COPY --from=builder /app/dist/apps/ui-angular/browser /usr/share/nginx/html
COPY apps/ui-angular/nginx.conf /etc/nginx/nginx.conf.template
CMD ["/bin/sh", "-c", "envsubst '${CV_API_UPSTREAM}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
EXPOSE 80
