package com.fttranscendence.chatservice.dto;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.boot.test.json.JacksonTester;
import org.springframework.boot.test.json.JsonContent;

import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.model.SystemEvent;

/**
 * The JSON the frontend actually receives, serialized with Boot's ObjectMapper
 * (spring.jackson.* from application.properties, so snake_case). REST and
 * WebSocket frames both use this DTO.
 */
@JsonTest
class MessageResponseJsonTest {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";

    @Autowired
    private JacksonTester<MessageResponse> json;

    @Test
    @DisplayName("a system message: no sender or content, and a snake_case system object")
    void systemMessageShape() throws Exception {
        Message message = Message.system(42L, "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                new SystemEvent("ROLE_CHANGED", ALICE, BOB, "ADMIN", "MEMBER", null, null),
                Instant.parse("2026-10-22T10:00:00.123Z"));

        JsonContent<MessageResponse> written = json.write(MessageResponse.from(message));

        assertThat(written).extractingJsonPathStringValue("$.content_type").isEqualTo("system");
        assertThat(written).hasJsonPathValue("$.room_id");
        assertThat(written).extractingJsonPathValue("$.sender_id").isNull();
        assertThat(written).extractingJsonPathValue("$.content").isNull();
        assertThat(written).extractingJsonPathStringValue("$.system.type").isEqualTo("ROLE_CHANGED");
        assertThat(written).extractingJsonPathStringValue("$.system.actor_id").isEqualTo(ALICE);
        assertThat(written).extractingJsonPathStringValue("$.system.target_id").isEqualTo(BOB);
        assertThat(written).extractingJsonPathStringValue("$.system.role").isEqualTo("ADMIN");
        assertThat(written).extractingJsonPathStringValue("$.system.previous_role").isEqualTo("MEMBER");
        // Unused fields are present and null, so the frontend never meets a missing key.
        assertThat(written).hasJsonPath("$.system.name");
        assertThat(written).hasJsonPath("$.system.previous_name");
        // The internal event id is not part of the API.
        assertThat(written).doesNotHaveJsonPath("$.event_id");
    }

    @Test
    @DisplayName("an ordinary message keeps its shape and has system: null")
    void ordinaryMessageShape() throws Exception {
        Message message = Message.create(42L, ALICE, null, "hello", "text", Instant.now());

        JsonContent<MessageResponse> written = json.write(MessageResponse.from(message));

        assertThat(written).extractingJsonPathStringValue("$.content").isEqualTo("hello");
        assertThat(written).extractingJsonPathStringValue("$.sender_id").isEqualTo(ALICE);
        assertThat(written).hasJsonPath("$.system");
        assertThat(written).extractingJsonPathValue("$.system").isNull();
    }
}
