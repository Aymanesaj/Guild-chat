package com.fttranscendence.chatservice.config;

import java.time.Clock;
import java.time.Duration;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * A Clock bean instead of Instant.now() calls, so tests can pin time exactly
 * — needed for the 15-minute edit window.
 */

@Configuration
public class TimeConfig {

    /** Delayed offline notifications; cancelled tasks must not accumulate on refresh. */
    @Bean
    public ThreadPoolTaskScheduler presenceScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("presence-");
        scheduler.setRemoveOnCancelPolicy(true);
        return scheduler;
    }

    @Bean
    public Clock clock() {
        return Clock.tick(Clock.systemUTC(), Duration.ofMillis(1));
    }
}
