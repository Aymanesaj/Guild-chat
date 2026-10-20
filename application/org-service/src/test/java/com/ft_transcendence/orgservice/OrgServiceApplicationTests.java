package com.ft_transcendence.orgservice;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class OrgServiceApplicationTests {

    @org.springframework.test.context.bean.override.mockito.MockitoBean
    org.springframework.amqp.rabbit.core.RabbitAdmin rabbitAdmin;

	@Test
	void contextLoads() {
	}

}
