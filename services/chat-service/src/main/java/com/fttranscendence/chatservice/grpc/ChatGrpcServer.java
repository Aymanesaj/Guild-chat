package com.fttranscendence.chatservice.grpc;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import io.grpc.Server;
import io.grpc.ServerBuilder;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

/**
 * chat-service's own gRPC server. Until now chat only called others (identity,
 * org); this is the way back in, so org can push room changes instead of
 * the frontend polling for them.
 *
 * Runs next to Tomcat on its own port (chat.grpc.server.port, 9090 in Docker).
 * Port 0 picks a free port, which the tests use: several Spring contexts can
 * be alive in one test JVM, and they cannot all bind 9090.
 */
@Component
public class ChatGrpcServer {

    private static final Logger log = LoggerFactory.getLogger(ChatGrpcServer.class);

    private final ChatNotifyGrpcService notifyService;
    private final int port;
    private Server server;

    public ChatGrpcServer(ChatNotifyGrpcService notifyService, @Value("${chat.grpc.server.port}") int port) {
        this.notifyService = notifyService;
        this.port = port;
    }

    /** Fails startup if the port is taken: a chat that org cannot reach would silently stop live updates. */
    @PostConstruct
    void start() throws IOException {
        server = ServerBuilder.forPort(port)
                .addService(notifyService)
                .build()
                .start();
        log.info("gRPC server listening on port {}", server.getPort());
    }

    /** The bound port: differs from the configured one when that was 0. */
    public int port() {
        return server.getPort();
    }

    @PreDestroy
    void stop() throws InterruptedException {
        if (server != null) {
            server.shutdown();
            server.awaitTermination(5, TimeUnit.SECONDS);
        }
    }
}
