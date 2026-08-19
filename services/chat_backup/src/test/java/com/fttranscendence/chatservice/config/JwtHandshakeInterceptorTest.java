package com.fttranscendence.chatservice.config;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class JwtHandshakeInterceptorTest {

    private static final String SECRET = "test-secret-key-that-is-at-least-32-bytes-long";

    private JwtHandshakeInterceptor interceptor;
    private SecretKey signingKey;

    @BeforeEach
    void setUp() {
        interceptor = new JwtHandshakeInterceptor(SECRET);
        signingKey = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void rejectsHandshake_whenNoTokenProvided() throws Exception {
        ServerHttpRequest request = new ServletServerHttpRequest(new MockHttpServletRequest());
        MockHttpServletResponse mockResponse = new MockHttpServletResponse();
        ServerHttpResponse response = new ServletServerHttpResponse(mockResponse);
        Map<String, Object> attributes = new HashMap<>();

        boolean result = interceptor.beforeHandshake(request, response, null, attributes);

        assertThat(result).isFalse();
        assertThat(mockResponse.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED.value());
    }

    @Test
    void rejectsHandshake_whenTokenIsInvalid() throws Exception {
        MockHttpServletRequest mockRequest = new MockHttpServletRequest();
        mockRequest.addHeader("Authorization", "Bearer not-a-real-token");
        ServerHttpRequest request = new ServletServerHttpRequest(mockRequest);
        ServerHttpResponse response = new ServletServerHttpResponse(new MockHttpServletResponse());
        Map<String, Object> attributes = new HashMap<>();

        boolean result = interceptor.beforeHandshake(request, response, null, attributes);

        assertThat(result).isFalse();
    }

    @Test
    void acceptsHandshake_andExposesClaims_whenTokenIsValidInAuthorizationHeader() throws Exception {
        String token = validToken("user-42", "alice");
        MockHttpServletRequest mockRequest = new MockHttpServletRequest();
        mockRequest.addHeader("Authorization", "Bearer " + token);
        ServerHttpRequest request = new ServletServerHttpRequest(mockRequest);
        ServerHttpResponse response = new ServletServerHttpResponse(new MockHttpServletResponse());
        Map<String, Object> attributes = new HashMap<>();

        boolean result = interceptor.beforeHandshake(request, response, null, attributes);

        assertThat(result).isTrue();
        assertThat(attributes.get("userId")).isEqualTo("user-42");
        assertThat(attributes.get("username")).isEqualTo("alice");
    }

    @Test
    void acceptsHandshake_whenTokenIsInQueryParam() throws Exception {
        String token = validToken("user-42", "alice");
        MockHttpServletRequest mockRequest = new MockHttpServletRequest();
        mockRequest.setQueryString("token=" + token);
        ServerHttpRequest request = new ServletServerHttpRequest(mockRequest);
        ServerHttpResponse response = new ServletServerHttpResponse(new MockHttpServletResponse());
        Map<String, Object> attributes = new HashMap<>();

        boolean result = interceptor.beforeHandshake(request, response, null, attributes);

        assertThat(result).isTrue();
        assertThat(attributes.get("userId")).isEqualTo("user-42");
    }

    private String validToken(String subject, String username) {
        return Jwts.builder()
                .subject(subject)
                .claim("username", username)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 60_000))
                .signWith(signingKey)
                .compact();
    }
}
