FROM alpine:latest

RUN apk add --no-cache curl jq busybox-extras postgresql-client bash 

COPY script.sh /

RUN chmod +x /script.sh

ENTRYPOINT ["bash", "/script.sh"]