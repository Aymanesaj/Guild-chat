FROM alpine:3.20

RUN apk add --no-cache \
    postgresql16-client \
    mongodb-tools \
    gzip \
    bash \
    tzdata

WORKDIR /app

COPY backup.sh .
RUN chmod +x backup.sh

CMD ["./backup.sh"]

