package com.fttranscendence.chatservice.message.domain;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "rooms")
public class Room {

    @Id
    private String id;

    private RoomType type;

    private String name;          // null for DMs, set for groups

    private List<String> memberIds;

    private Instant createdAt;

    public enum RoomType { DM, GROUP }
}