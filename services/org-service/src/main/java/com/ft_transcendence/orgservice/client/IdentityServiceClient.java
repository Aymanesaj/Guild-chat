package com.ft_transcendence.orgservice.client;

import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.HttpClientErrorException;
import jakarta.servlet.http.HttpServletRequest;

@Component
public class IdentityServiceClient {

    private final RestClient restClient;
    private static final String IDENTITY_SERVICE_BASE_URL = "http://identity-service:8083";
    private static final String USER_EXISTS_ENDPOINT = "/{id}";
    private final HttpServletRequest request;

    public IdentityServiceClient(RestClient.Builder restClientBuilder, HttpServletRequest request) {
        this.restClient = restClientBuilder
                .baseUrl(IDENTITY_SERVICE_BASE_URL)
                .build();
        this.request = request;
    }

    public boolean userExists(UUID userId) {
        try {
            String authHeader = request.getHeader("Authorization");
            restClient.get()
                    .uri(USER_EXISTS_ENDPOINT, userId)
                    .header("Authorization", authHeader)
                    .retrieve()
                    .toBodilessEntity();

            return true;
        } catch (HttpClientErrorException.NotFound e) {
            return false;
        }
    }
}