FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

RUN apk add --no-cache maven gcompat

COPY chat-service/pom.xml .
COPY chat-service/.mvn .mvn
COPY chat-service/mvnw mvnw
COPY chat-service/src src

RUN chmod +x mvnw && ./mvnw -q -DskipTests clean package

RUN jlink \
    --add-modules java.base,java.compiler,java.desktop,java.instrument,java.management,java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.security.jgss,java.security.sasl,java.sql,java.sql.rowset,java.transaction.xa,java.xml,java.xml.crypto,jdk.crypto.ec,jdk.unsupported,jdk.management,jdk.management.agent,jdk.net \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=2 \
    --output /custom-jre

FROM alpine:3.20

RUN apk add --no-cache wget \
    && addgroup -g 1000 app \
    && adduser -u 1000 -G app -s /bin/sh -D app

ENV JAVA_HOME=/opt/jre
ENV PATH="${JAVA_HOME}/bin:${PATH}"

COPY --from=build --chown=app:app /custom-jre /opt/jre

WORKDIR /app
COPY --from=build --chown=app:app /app/target/*.jar app.jar

USER app

EXPOSE 8081

ENTRYPOINT ["java", "-jar", "app.jar"]
