FROM node:24-alpine AS frontend-builder
WORKDIR /app
COPY frontend/app/package*.json ./
RUN npm ci
COPY frontend/app/ ./
RUN npm run build

FROM owasp/modsecurity-crs:nginx
USER root
RUN apt-get update \
    && apt-get install openssl libmodsecurity3 modsecurity-crs -y \
    && apt-get clean
RUN rm /etc/nginx/conf.d/default.conf
COPY ./gateway/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
COPY ./gateway/script.sh .

RUN chmod +x ./script.sh
ENTRYPOINT [ "./script.sh" ]

CMD [ "nginx", "-g", "daemon off;" ]