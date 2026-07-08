FROM node:18-alpine
RUN apk add --no-cache busybox-extras
WORKDIR /app
COPY health.sh .
RUN chmod +x health.sh
EXPOSE 8080
ENTRYPOINT ["./health.sh"]