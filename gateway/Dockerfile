FROM owasp/modsecurity-crs:nginx 

USER root

RUN apt-get update && apt-get install openssl -y

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/nginx.conf

COPY script.sh .

RUN chmod +x ./script.sh

ENTRYPOINT [ "./script.sh" ]

CMD [ "nginx", "-g", "daemon off;" ]