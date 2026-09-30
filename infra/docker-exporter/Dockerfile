FROM alpine:latest

RUN apk add --no-cache curl jq busybox-extras bash

COPY script.sh /

RUN chmod +x /script.sh

USER 65534

ENTRYPOINT ["bash", "/script.sh"]
