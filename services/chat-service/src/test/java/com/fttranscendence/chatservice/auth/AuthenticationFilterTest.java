package com.fttranscendence.chatservice.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.IdentityClient;

import jakarta.servlet.http.HttpServletRequest;

/**
 * The filter is the front door: if it lets a request through without a valid
 * token, every endpoint behind it is open. These tests drive it directly with
 * mock servlet objects — no Spring context, no network.
 */
@ExtendWith(MockitoExtension.class)
class AuthenticationFilterTest {

    private static final String TOKEN = "header.payload.signature";
    private static final String USER_ID = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    @Mock
    private IdentityClient identityClient;

    private AuthenticationFilter filter;
    private MockHttpServletResponse response;
    private MockFilterChain chain;

    @BeforeEach
    void setUp() {
        filter = new AuthenticationFilter(identityClient, new ObjectMapper());
        response = new MockHttpServletResponse();
        chain = new MockFilterChain();
    }

    private MockHttpServletRequest request(String path, String authorizationHeader) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        if (authorizationHeader != null) {
            request.addHeader("Authorization", authorizationHeader);
        }
        return request;
    }

    /** True when the request reached the rest of the chain. */
    private boolean passedThrough() {
        return chain.getRequest() != null;
    }

    private String body() {
        try {
            return response.getContentAsString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("valid token: publishes the user id and continues the chain")
    void validTokenPassesThrough() throws Exception {
        when(identityClient.validateToken(TOKEN)).thenReturn(Optional.of(USER_ID));
        MockHttpServletRequest request = request("/rooms/42/messages", "Bearer " + TOKEN);

        filter.doFilter(request, response, chain);

        assertThat(passedThrough()).isTrue();
        assertThat(request.getAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE)).isEqualTo(USER_ID);
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("no Authorization header: 401 UNAUTHORIZED and the chain is not continued")
    void missingHeaderIsRejected() throws Exception {
        filter.doFilter(request("/rooms/42/messages", null), response, chain);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(body()).contains("UNAUTHORIZED");
        assertThat(passedThrough()).as("a rejected request must never reach the controller").isFalse();
        verifyNoInteractions(identityClient);
    }

    @Test
    @DisplayName("wrong scheme (Basic): 401, and identity is never asked")
    void basicAuthIsRejected() throws Exception {
        filter.doFilter(request("/rooms/42/messages", "Basic dXNlcjpwYXNz"), response, chain);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(passedThrough()).isFalse();
        verifyNoInteractions(identityClient);
    }

    @Test
    @DisplayName("'Bearer' with nothing after it: 401, not an empty-token call to identity")
    void emptyBearerTokenIsRejected() throws Exception {
        filter.doFilter(request("/rooms/42/messages", "Bearer    "), response, chain);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(passedThrough()).isFalse();
        verify(identityClient, never()).validateToken(any());
    }

    @Test
    @DisplayName("token rejected by identity: 401 INVALID_TOKEN so the client knows to refresh")
    void invalidTokenIsRejected() throws Exception {
        when(identityClient.validateToken("tampered")).thenReturn(Optional.empty());

        filter.doFilter(request("/rooms/42/messages", "Bearer tampered"), response, chain);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(body()).contains("INVALID_TOKEN");
        assertThat(passedThrough()).isFalse();
    }

    @Test
    @DisplayName("identity unreachable: 503, never 401, and the request is still blocked")
    void identityOutageIsServiceUnavailable() throws Exception {
        when(identityClient.validateToken(TOKEN)).thenThrow(new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "IDENTITY_UNAVAILABLE", "identity-service is unavailable"));

        filter.doFilter(request("/rooms/42/messages", "Bearer " + TOKEN), response, chain);

        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(body()).contains("IDENTITY_UNAVAILABLE");
        assertThat(passedThrough()).isFalse();
    }

    @Test
    @DisplayName("errors use the spec envelope and are JSON")
    void errorBodyUsesTheSpecEnvelope() throws Exception {
        filter.doFilter(request("/rooms/42/messages", null), response, chain);

        assertThat(response.getContentType()).contains("application/json");

        // Parsed rather than string-compared: Map.of has no defined iteration
        // order, so the key order in the JSON varies between runs.
        com.fasterxml.jackson.databind.JsonNode json = new ObjectMapper().readTree(body());
        assertThat(json.path("error").path("code").asText()).isEqualTo("UNAUTHORIZED");
        assertThat(json.path("error").path("message").asText()).isEqualTo("Missing bearer token");
    }

    @Test
    @DisplayName("health probes are skipped: no token needed, identity never called")
    void actuatorIsNotFiltered() {
        HttpServletRequest health = request("/actuator/health", null);

        assertThat(filter.shouldNotFilter(health)).isTrue();
    }

    @Test
    @DisplayName("the WebSocket handshake is skipped: it authenticates in its own interceptor")
    void webSocketPathsAreNotFiltered() {
        assertThat(filter.shouldNotFilter(request("/ws", null))).isTrue();
        assertThat(filter.shouldNotFilter(request("/ws/chat", null))).isTrue();
    }

    @Test
    @DisplayName("normal endpoints are filtered")
    void businessPathsAreFiltered() {
        assertThat(filter.shouldNotFilter(request("/rooms/42/messages", null))).isFalse();
        assertThat(filter.shouldNotFilter(request("/messages/abc", null))).isFalse();
    }
}
