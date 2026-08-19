package com.fttranscendence.chatservice.message.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A room member as chat-service knows them.
 *
 * Deliberately carries no username or avatar: identity-service owns user data.
 * The client resolves the display profile with GET /api/users/{userId}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class RoomMemberResponse {

    private String userId;

    private boolean online;   // derived from live WebSocket sessions, not stored
}
