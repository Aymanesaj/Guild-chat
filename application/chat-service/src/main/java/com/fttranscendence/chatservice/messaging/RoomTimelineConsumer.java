package com.fttranscendence.chatservice.messaging;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.config.RabbitMQConfig;
import com.fttranscendence.chatservice.model.SystemEvent;
import com.fttranscendence.chatservice.service.MessageService;

/**
 * Turns org's room timeline events into system messages in the room's history.
 *
 * Everything is validated before anything is stored: a malformed event is
 * rejected and, after the usual retries, lands in the dead-letter queue.
 * Only the fields that matter for the event's type are kept.
 */
@Component
public class RoomTimelineConsumer {

    private static final Logger logger = LoggerFactory.getLogger(RoomTimelineConsumer.class);

    private static final Set<String> ROLES = Set.of("OWNER", "ADMIN", "MEMBER");

    private final MessageService messages;

    public RoomTimelineConsumer(MessageService messages) {
        this.messages = messages;
    }

    @RabbitListener(queues = RabbitMQConfig.CHAT_ROOM_TIMELINE_QUEUE)
    public void consume(RoomTimelineMessage event) {
        SystemEvent system = validate(event);
        Long roomId = Long.valueOf(event.roomId());
        Instant occurredAt = Instant.parse(event.occurredAt());

        boolean stored = messages.recordSystemEvent(roomId, event.eventId(), system, occurredAt);

        if (stored) {
            logger.info("Stored room event type={} room={} eventId={}", event.type(), roomId, event.eventId());
        } else {
            logger.info("Ignored redelivered room event type={} room={} eventId={}",
                    event.type(), roomId, event.eventId());
        }
    }

    /** Checks the event against the contract and keeps only its type's fields. */
    private static SystemEvent validate(RoomTimelineMessage event) {
        if (event == null || event.type() == null) {
            throw new IllegalArgumentException("Invalid room timeline event");
        }
        if (event.version() == null || event.version() != 1) {
            throw new IllegalArgumentException("Unsupported room timeline version: " + event.version());
        }

        requireUuid(event.eventId(), "eventId");
        requireUuid(event.actorId(), "actorId");
        if (event.roomId() == null || !event.roomId().matches("[1-9][0-9]*")) {
            throw new IllegalArgumentException("roomId must be a positive decimal Long string");
        }
        Long.parseLong(event.roomId()); // rejects values beyond Long's range
        if (event.occurredAt() == null) {
            throw new IllegalArgumentException("occurredAt is required");
        }
        try {
            Instant.parse(event.occurredAt());
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("occurredAt must be an ISO-8601 instant", e);
        }
        String type = event.type().name();
        String actor = event.actorId();
        return switch (event.type()) {
            case ROOM_CREATED, ROOM_RENAMED -> {
                requireText(event.name(), "name");
                yield new SystemEvent(type, actor, null, null, null,
                        event.name(), event.type() == RoomTimelineType.ROOM_RENAMED ? event.previousName() : null);
            }
            case MEMBER_JOINED -> {
                requireUuid(event.targetId(), "targetId");
                yield new SystemEvent(type, actor, event.targetId(), null, null, null, null);
            }
            case MEMBER_LEFT -> {
                requireUuid(event.targetId(), "targetId");
                if (!actor.equalsIgnoreCase(event.targetId())) {
                    throw new IllegalArgumentException("MEMBER_LEFT must have actorId == targetId");
                }
                yield new SystemEvent(type, actor, event.targetId(), null, null, null, null);
            }
            case MEMBER_KICKED -> {
                requireUuid(event.targetId(), "targetId");
                if (actor.equalsIgnoreCase(event.targetId())) {
                    throw new IllegalArgumentException("MEMBER_KICKED needs a different actor and target");
                }
                yield new SystemEvent(type, actor, event.targetId(), null, null, null, null);
            }
            case OWNERSHIP_TRANSFERRED -> {
                requireUuid(event.targetId(), "targetId");
                if (!"OWNER".equals(event.role())) {
                    throw new IllegalArgumentException("OWNERSHIP_TRANSFERRED must have role OWNER");
                }
                requireRole(event.previousRole(), "previousRole");
                yield new SystemEvent(type, actor, event.targetId(), event.role(), event.previousRole(), null, null);
            }
            case ROLE_CHANGED -> {
                requireUuid(event.targetId(), "targetId");
                requireRole(event.role(), "role");
                requireRole(event.previousRole(), "previousRole");
                yield new SystemEvent(type, actor, event.targetId(), event.role(), event.previousRole(), null, null);
            }
        };
    }

    private static void requireUuid(String value, String field) {
        // UUID.fromString throws IllegalArgumentException for malformed input too.
        if (value == null || !UUID.fromString(value).toString().equalsIgnoreCase(value)) {
            throw new IllegalArgumentException(field + " must be a UUID string");
        }
    }

    private static void requireRole(String value, String field) {
        // Set.of(...).contains(null) throws NullPointerException: check null first.
        if (value == null || !ROLES.contains(value)) {
            throw new IllegalArgumentException(field + " must be OWNER, ADMIN or MEMBER");
        }
    }

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
    }
}
