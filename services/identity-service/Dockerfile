FROM eclipse-temurin:21-jdk-alpine AS build

RUN apk add --no-cache maven gcompat

WORKDIR /app
COPY demo/pom.xml .
RUN mvn -q -DskipTests dependency:go-offline
COPY demo/src ./src
RUN mvn -q -DskipTests package

RUN jlink \
    --add-modules java.base,java.compiler,java.desktop,java.instrument,java.management,java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.security.jgss,java.security.sasl,java.sql,java.sql.rowset,java.transaction.xa,java.xml,java.xml.crypto,jdk.crypto.ec,jdk.unsupported,jdk.management,jdk.management.agent,jdk.net \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=2 \
    --output /custom-jre

FROM alpine:3.20

RUN apk add --no-cache curl \
    && addgroup -g 1000 app \
    && adduser -u 1000 -G app -s /bin/sh -D app \
    && mkdir -p /tmp/identity-avatars \
    && chown -R app:app /tmp/identity-avatars

ENV JAVA_HOME=/opt/jre
ENV PATH="${JAVA_HOME}/bin:${PATH}"

COPY --from=build --chown=app:app /custom-jre /opt/jre

WORKDIR /app
COPY --from=build --chown=app:app /app/target/identity-service-0.0.1-SNAPSHOT.jar app.jar

USER app

EXPOSE 8083

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
