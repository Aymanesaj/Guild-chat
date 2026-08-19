# ...existing code...
FROM maven:3.9.16-eclipse-temurin-21 AS build
WORKDIR /app

COPY chat-service/pom.xml .
COPY chat-service/.mvn .mvn
COPY chat-service/mvnw mvnw
COPY chat-service/src src

RUN chmod +x mvnw && ./mvnw -DskipTests clean package

FROM eclipse-temurin:21-jre
WORKDIR /app

COPY --from=build /app/target/*.jar app.jar
EXPOSE 8081

ENTRYPOINT ["java", "-jar", "app.jar"]