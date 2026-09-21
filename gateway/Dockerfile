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

RUN rm -rf /etc/nginx/templates/nginx.conf.template \
           /etc/nginx/templates/conf.d \
           /etc/nginx/templates/includes \
           /etc/nginx/conf.d/default.conf \
    && rm -f /docker-entrypoint.d/91-update-resolver.sh \
             /docker-entrypoint.d/92-update-real_ip.sh \
             /docker-entrypoint.d/93-update-proxy-ssl-config.sh \
             /docker-entrypoint.d/96-update-http3-config.sh

COPY ./gateway/modsec/modsecurity-override.conf /etc/nginx/templates/modsecurity.d/modsecurity-override.conf.template
COPY ./gateway/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
COPY ./gateway/script.sh .

RUN chmod +x ./script.sh
ENTRYPOINT [ "./script.sh" ]

CMD [ "nginx", "-g", "daemon off;" ]