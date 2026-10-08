package com.fttranscendence.chatservice.config;


import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;
import com.fttranscendence.chatservice.websocket.TokenHandshakeInterceptor;

/**
 * Registers the raw WebSocket endpoint. Deliberately no STOMP and no SockJS:
 * we want the frames visible.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    private final ChatWebSocketHandler chatWebSocketHandler;

    private final TokenHandshakeInterceptor tokenHandshakeInterceptor;

    public WebSocketConfig(ChatWebSocketHandler chatWebSocketHandler, TokenHandshakeInterceptor tokenHandshakeInterceptor) {
        this.chatWebSocketHandler = chatWebSocketHandler;
        this.tokenHandshakeInterceptor = tokenHandshakeInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatWebSocketHandler, "/ws/chat")
                .addInterceptors(tokenHandshakeInterceptor)
                // The browser reaches us through the gateway, same origin. Kept
                // permissive for local development against Vite on another port.
                .setAllowedOrigins("*");
    }

    /**
     * Without an idle timeout, a connection whose peer vanished (laptop lid,
     * dead wifi) is never closed: afterConnectionClosed may never fire, the
     * session stays in the registry, and we keep broadcasting into a socket
     * nobody reads. This is the backstop.
     */
    @Bean
    public ServletServerContainerFactoryBean webSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxSessionIdleTimeout(10 * 60 * 1000L);
        container.setMaxTextMessageBufferSize(64 * 1024);
        return container;
    }
}
