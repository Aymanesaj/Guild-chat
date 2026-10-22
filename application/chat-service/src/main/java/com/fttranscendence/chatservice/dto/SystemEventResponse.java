package com.fttranscendence.chatservice.dto;

import com.fttranscendence.chatservice.model.SystemEvent;

/**
 * The "system" object of a system message. Its own DTO so the API does not
 * change when the stored document does. JSON keys come out snake_case
 * (actor_id, previous_role, ...) like the rest of the API.
 */

public record SystemEventResponse(
        String type,
        String actorId,
        String targetId,
        String role,
        String previousRole,
        String name ,
        String previousName
){
    /** Null for an ordinary message. */
    public static SystemEventResponse from(SystemEvent system) {
        if (system == null) {
            return null;
        }
        return new SystemEventResponse(system.type(), system.actorId(), system.targetId(),
                system.role(), system.previousRole(), system.name(), system.previousName());
    }
}
