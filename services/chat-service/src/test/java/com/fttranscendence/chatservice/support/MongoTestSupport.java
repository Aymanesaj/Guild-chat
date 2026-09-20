package com.fttranscendence.chatservice.support;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MongoDBContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * One MongoDB container shared by every test class that needs a database.
 *
 * Started once in a static initializer (the "singleton container" pattern)
 * rather than per class via @Testcontainers, so a suite of N test classes
 * costs one container start instead of N. Ryuk stops it when the JVM exits.
 */
public abstract class MongoTestSupport {

    protected static final MongoDBContainer MONGO =
            new MongoDBContainer(DockerImageName.parse("mongo:7"));

    static {
        MONGO.start();
    }

    @DynamicPropertySource
    static void mongoProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.mongodb.uri", MONGO::getReplicaSetUrl);
    }
}
