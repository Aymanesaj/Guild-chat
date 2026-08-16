package com.fttranscendence.chatservice.message.domain;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "messages")
// Matches findByRoomIdOrderBySentAtDesc exactly: filter by roomId, then walk
// sentAt in already-sorted order. A roomId-only index would still force Mongo
// to sort the matched documents in memory.
@CompoundIndex(name = "room_sent_idx", def = "{'roomId': 1, 'sentAt': -1}")
public class ChatMessage {

    @Id
    private String id;

    private String roomId;

    private String senderId;    // always from verified JWT sub, never client input

    private String content;

    private Instant sentAt;
}