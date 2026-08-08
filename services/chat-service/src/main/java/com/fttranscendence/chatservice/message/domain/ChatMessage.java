package com.fttranscendence.chatservice.message.domain;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "messages")
public class ChatMessage {

    @Id
    private String id;

    @Indexed
    private String roomId;      // indexed — you'll query by this constantly

    private String senderId;    // always from verified JWT sub, never client input

    private String content;

    private Instant sentAt;
}