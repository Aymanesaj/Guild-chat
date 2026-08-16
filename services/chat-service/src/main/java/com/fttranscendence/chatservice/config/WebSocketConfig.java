package com.fttranscendence.chatservice.config;

import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {

    private final ChatWebSocketHandler chatWebSocketHandler;
    private final JwtHandshakeInterceptor jwtHandshakeInterceptor;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatWebSocketHandler, "/ws/chat")
                .addInterceptors(jwtHandshakeInterceptor)
                .setAllowedOrigins("*");
    }

    /**
     * Hard ceiling on how many bytes the WebSocket container will buffer for a
     * single frame, enforced by Tomcat before our code ever runs.
     *
     * This is a different defence from @Size(max = 2000) on IncomingMessage.
     * The annotation is checked after Jackson has already parsed the frame into
     * a Java String — so a 50 MB frame would be fully read into heap first, and
     * a few concurrent ones could exhaust memory before any validation ran.
     * This limit rejects the frame at the protocol layer instead.
     *
     * 16 KB leaves generous headroom over the 2000-character message limit
     * (~8 KB worst case in UTF-8) plus the surrounding JSON.
     */
    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(16 * 1024);
        container.setMaxBinaryMessageBufferSize(16 * 1024);
        return container;
    }
}
