package com.fttranscendence.chatservice.service;

import com.fttranscendence.chatservice.model.Message;

/**
 * Published once a message is stored. The service announces the fact and
 * does not know who listens: today the WebSocket broadcaster, later maybe
 * Redis pub/sub for a second chat instance.
 */

public record MessageCreatedEvent(Message message) {
}
