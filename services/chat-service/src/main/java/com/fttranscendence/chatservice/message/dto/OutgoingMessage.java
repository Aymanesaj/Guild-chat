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

    /**
     * Discriminator so the client can tell a chat message from an ErrorFrame
     * without guessing from which fields happen to be present.
     * Builder.Default keeps the value when the object is built via builder().
     */
    @Builder.Default
    private String type = "MESSAGE";

    private String id;
    private String roomId;
    private String senderId;
    private String senderUsername;
    private String content;
    private Instant sentAt;
}