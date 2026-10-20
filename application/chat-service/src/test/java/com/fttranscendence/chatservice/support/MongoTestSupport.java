package com.fttranscendence.chatservice.support;

import java.time.Duration;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;

/**
 * One MongoDB container shared by every test class that needs a database.
 *
 * It runs WITH authentication and is wired through the same CHAT_MONGO_*
 * variables the real deployment uses, so the production application.properties
 * is exercised as written — credentials, auth database and all — instead of
 * being shadowed by a test-only copy that could silently drift from it.
 *
 * Started once in a static initializer (the "singleton container" pattern), so
 * a suite of N test classes costs one container start instead of N.
 */
public abstract class MongoTestSupport {

    private static final String USERNAME = "chat_test";
    private static final String PASSWORD = "chat_test_password";
    private static final String DATABASE = "chatdb";

    @SuppressWarnings("resource") // stopped by Ryuk when the JVM exits
    protected static final GenericContainer<?> MONGO =
            new GenericContainer<>("mongo:7")
                    .withExposedPorts(27017)
                    .withEnv("MONGO_INITDB_ROOT_USERNAME", USERNAME)
                    .withEnv("MONGO_INITDB_ROOT_PASSWORD", PASSWORD)
                    .waitingFor(Wait.forLogMessage(".*Waiting for connections.*", 2))
                    .withStartupTimeout(Duration.ofMinutes(2));

    static {
        MONGO.start();
    }

    @DynamicPropertySource
    static void mongoProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.mongodb.host", MONGO::getHost);
        registry.add("spring.data.mongodb.port", () -> MONGO.getMappedPort(27017));
        registry.add("spring.data.mongodb.database", () -> DATABASE);
        registry.add("spring.data.mongodb.username", () -> USERNAME);
        registry.add("spring.data.mongodb.password", () -> PASSWORD);
        registry.add("spring.data.mongodb.authentication-database", () -> "admin");

        registry.add("CHAT_MONGO_HOST", MONGO::getHost);
        registry.add("CHAT_MONGO_PORT", () -> MONGO.getMappedPort(27017));
        registry.add("CHAT_MONGO_DB", () -> DATABASE);
        registry.add("CHAT_MONGO_USER", () -> USERNAME);
        registry.add("CHAT_MONGO_PASSWORD", () -> PASSWORD);
        registry.add("CHAT_MONGO_AUTH_DB", () -> "admin");

        registry.add("RABBITMQ_DEFAULT_USER", () -> "test");
        registry.add("RABBITMQ_DEFAULT_PASS", () -> "test");
        // These Mongo/WebSocket tests invoke the consumer directly; no application queue access.
        registry.add("spring.rabbitmq.listener.simple.auto-startup", () -> false);
        registry.add("spring.rabbitmq.dynamic", () -> false);
    }
}
