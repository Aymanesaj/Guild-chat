package com.fttranscendence.chatservice.config;

import java.time.Clock;
import java.time.Duration;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * A Clock bean instead of Instant.now() calls, so tests can pin time exactly
 * — needed for the 15-minute edit window.
 */

@Configuration
public class TimeConfig {

    @Bean
    public Clock clock() {
        return Clock.tick(Clock.systemUTC(), Duration.ofMillis(1));
    }
}
