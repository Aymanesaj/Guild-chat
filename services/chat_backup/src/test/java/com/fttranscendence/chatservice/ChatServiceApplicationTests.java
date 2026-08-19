package com.fttranscendence.chatservice;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Smoke test: does the whole application context actually start?
 *
 * RANDOM_PORT rather than the default MOCK web environment, because
 * WebSocketConfig now declares a ServletServerContainerFactoryBean. That bean
 * reads the 'jakarta.websocket.server.ServerContainer' attribute out of the
 * ServletContext, which only a real embedded Tomcat provides — under MOCK the
 * context fails to start with IllegalStateException.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ChatServiceApplicationTests {

	@Test
	void contextLoads() {
	}

}
