package com.fttranscendence.chatservice.message.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OutgoingMessage {

    private String id;
    private String roomId;
    private String senderId;
    private String senderUsername;
    private String content;
    private Instant sentAt;
}