package com.fttranscendence.chatservice.auth;

import java.io.IOException;
import java.util.Map;
import java.util.Optional;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.IdentityClient;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;


@Component
public class AuthenticationFilter extends OncePerRequestFilter {

    /**
     * Where the authenticated user id is published
     * for the rest of the request.
     */
    public static final String USER_ID_ATTRIBUTE = "chat.userId";

    private static final String BEARER_PREFIX = "Bearer ";

    private final IdentityClient identityClient;
    private final ObjectMapper objectMapper;

    public AuthenticationFilter(
            IdentityClient identityClient,
            ObjectMapper objectMapper) {

        this.identityClient = identityClient;
        this.objectMapper = objectMapper;
    }

    /**
     * Health probes stay open.
     *
     * WebSocket authentication is handled separately because
     * WebSocket connections do not pass through this HTTP
     * authentication flow in the same way.
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {

        String path = request.getRequestURI();

        return path.startsWith("/actuator/")
                || path.equals("/ws")
                || path.startsWith("/ws/");
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain)
            throws ServletException, IOException {

        String token = bearerToken(
                request.getHeader(HttpHeaders.AUTHORIZATION)
        );

        if (token == null) {
            writeError(
                    response,
                    401,
                    "UNAUTHORIZED",
                    "Missing bearer token"
            );
            return;
        }

        Optional<String> userId;

        try {
            userId = identityClient.validateToken(token);

        } catch (ApiException e) {

            // Identity service is unreachable.
            // This is 503, not 401: we could not verify the token.
            writeError(
                    response,
                    e.getStatus().value(),
                    e.getCode(),
                    e.getMessage()
            );
            return;
        }

        if (userId.isEmpty()) {
            writeError(
                    response,
                    401,
                    "INVALID_TOKEN",
                    "Invalid bearer token"
            );
            return;
        }

        request.setAttribute(
                USER_ID_ATTRIBUTE,
                userId.get()
        );

        // Authentication succeeded.
        // Let the request continue to the controller.
        filterChain.doFilter(request, response);
    }

    /**
     * Returns null unless the header is exactly:
     *
     *     Bearer <non-blank-token>
     */
    private String bearerToken(String header) {

        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            return null;
        }

        String token = header
                .substring(BEARER_PREFIX.length())
                .trim();

        return token.isEmpty() ? null : token;
    }

    private void writeError(
            HttpServletResponse response,
            int status,
            String code,
            String message)
            throws IOException {

        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");

        objectMapper.writeValue(
                response.getWriter(),
                Map.of(
                        "error",
                        Map.of(
                                "code", code,
                                "message", message
                        )
                )
        );
    }
}
