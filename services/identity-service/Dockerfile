FROM maven:3.9.9-eclipse-temurin-21 AS build

WORKDIR /app
COPY demo/pom.xml .
RUN mvn -q -DskipTests dependency:go-offline
COPY demo/src ./src
RUN mvn -q -DskipTests package
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/identity-service-0.0.1-SNAPSHOT.jar app.jar

EXPOSE 8083

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
