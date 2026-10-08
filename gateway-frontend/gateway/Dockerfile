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

COPY ./gateway-frontend/gateway/modsec/modsecurity-override.conf /etc/nginx/templates/modsecurity.d/modsecurity-override.conf.template

COPY ./gateway-frontend/gateway/nginx.conf /etc/nginx/nginx.conf.template
COPY ./gateway-frontend/gateway/script.sh .

RUN chmod +x ./script.sh \
    && mkdir -p /etc/nginx/conf /var/cache/nginx /var/log/nginx /var/run /tmp \
    && chown -R nginx:nginx /etc/nginx /etc/modsecurity.d /opt/owasp-crs /var/cache/nginx /var/log/nginx /var/run /tmp ./script.sh

USER nginx

ENTRYPOINT [ "./script.sh" ]

CMD [ "nginx", "-g", "daemon off;" ]