package com.fttranscendence.chatservice.message.domain;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
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

    // Who created a GROUP. Null for DMs: both members are equal peers, a DM has
    // no owner. Recorded now, before any room management exists, because it
    // cannot be backfilled later — the creator is not derivable from an existing
    // document. (memberIds[0] happens to be the creator today, but that is an
    // accident of Stream.concat ordering, not a guarantee.)
    private String ownerId;

    // Queried on every GET /api/rooms via findByMemberIdsContaining. Mongo
    // indexes each element of the array separately (a "multikey" index), so a
    // lookup by one member id is a direct index hit, not a scan of every room.
    @Indexed
    private List<String> memberIds;

    private Instant createdAt;

    public enum RoomType { DM, GROUP }
}