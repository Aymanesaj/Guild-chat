package com.ft_transcendence.orgservice.grpc;

import io.grpc.Server;
import io.grpc.ServerBuilder;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class GrpcServer {

    private final OrgGrpcService orgGrpcService;
    private Server server;

    public GrpcServer(OrgGrpcService orgGrpcService) {
        this.orgGrpcService = orgGrpcService;
    }

    @PostConstruct
    public void start() throws IOException {
        server = ServerBuilder
                .forPort(9090)
                .addService(orgGrpcService)
                .build()
                .start();

        System.out.println("gRPC server started on port 9090");
    }

    @PreDestroy
    public void stop() {
        if (server != null) {
            server.shutdown();
        }
    }
}