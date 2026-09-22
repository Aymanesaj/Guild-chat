package com.fttranscendence.chatservice.websocket;

import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.IdentityClient;

/**
 * Authenticates the WebSocket handshake — the last moment an HTTP status code
 * can still be returned. After the 101 there is no status code, only frames.
 *
 * The token arrives as ?token=… because a browser cannot set headers on a
 * WebSocket connection. Known weakness: query strings reach access logs, so
 * nothing here may log the URL or the token itself.
 */

@Component
public class TokenHandshakeInterceptor implements HandshakeInterceptor {

    private static final Logger log = LoggerFactory.getLogger(TokenHandshakeInterceptor.class);

     /** Key under which the user id is published into the WebSocket session. */
    public static final String USER_ID_ATTRIBUTE = "chat.userId";

    // private final TokenAuthenticator tokenAuthenticator;
    private final IdentityClient identityClient;

    public TokenHandshakeInterceptor(IdentityClient identityClient) {
        this.identityClient = identityClient;
    }


    @Override
    public boolean beforeHandshake(
            ServerHttpRequest request,
            ServerHttpResponse response,
            WebSocketHandler handler,
            Map<String, Object> attributes) throws Exception {
                String token = tokenFrom(request);
                if (token == null) {
                    response.setStatusCode(HttpStatus.UNAUTHORIZED);
                    log.debug("WebSocket handshake rejected: no token");
                    return false;
                }
                Optional<String> userId;
                try {
                    userId = identityClient.validateToken(token);
                }catch(ApiException e) {
                      // identity unreachable: refuse, but say it is our fault, not the token's
                      response.setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
                    log.warn("WebSocket handshake rejected: {}", e.getCode());
                    return false;
                }
                if (userId.isEmpty()){
                    response.setStatusCode(HttpStatus.UNAUTHORIZED);
                    log.debug("WebSocket handshake rejected: invalid token");
                    return false;
                }
                // Resolved once. Everything after this reads it from the session, so a
                // frame never costs another ValidateToken call.
                attributes.put(USER_ID_ATTRIBUTE, userId.get());
                return true;
            }
    @Override
    public void afterHandshake(
            ServerHttpRequest request,
            ServerHttpResponse response,
            WebSocketHandler handler,
            Exception exception) {
        // Nothing to do here.
    }
    /**Reads ?token=… from the handshake URL. */
    private String tokenFrom(ServerHttpRequest request) {
        if(!(request instanceof  ServletServerHttpRequest  servletRequest)) {
            return null ;
        }
        String token = servletRequest.getServletRequest().getParameter("token");
        return (token == null || token.isBlank()) ? null : token ;
    }
}
