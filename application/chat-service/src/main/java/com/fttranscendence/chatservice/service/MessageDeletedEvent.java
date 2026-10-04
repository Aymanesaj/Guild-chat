package com.fttranscendence.chatservice.service;


import com.fttranscendence.chatservice.model.Message;


/** Published once a soft delete is stored. Same role as MessageCreatedEvent. */
public record MessageDeletedEvent(Message message) {
}
