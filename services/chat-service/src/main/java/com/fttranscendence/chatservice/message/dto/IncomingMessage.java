package com.fttranscendence.chatservice.message.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * What a client sends over the WebSocket.
 *
 * These constraints are NOT enforced automatically. On a REST endpoint,
 * @Valid on a @RequestBody makes Spring MVC run the validator for you. A
 * WebSocket frame never touches Spring MVC — ChatWebSocketHandler parses the
 * JSON itself — so the handler has to invoke the Validator explicitly.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IncomingMessage {

    @NotBlank(message = "roomId is required")
    private String roomId;

    @NotBlank(message = "content must not be empty")
    @Size(max = 2000, message = "content must not exceed 2000 characters")
    private String content;
}
