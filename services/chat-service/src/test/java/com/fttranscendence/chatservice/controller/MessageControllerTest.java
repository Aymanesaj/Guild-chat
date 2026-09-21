package com.fttranscendence.chatservice.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.service.MessageService;

/**
 * The HTTP surface only: status codes, JSON shape, error envelope.
 * The service is mocked, so nothing here touches MongoDB.
 */
@WebMvcTest(MessageController.class)
@AutoConfigureMockMvc(addFilters = false) // the filter has its own test; this slice is the controller
class MessageControllerTest {

    private static final long ROOM = 42L;
    private static final String SENDER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    /**
     * A @WebMvcTest slice does not run the servlet filter chain, so the
     * attribute the filter would publish is set by hand here. The filter itself
     * is covered by AuthenticationFilterTest.
     */
    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
            authenticatedGet(String path) {
        return get(path).requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, SENDER);
    }

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private MessageService messageService;

    /** @WebMvcTest includes Filter beans, so AuthenticationFilter's dependency must exist. */
    @MockBean
    private IdentityClient identityClient;

    private Message message(String content) {
        return Message.create(ROOM, SENDER, null, content, "text",
                Instant.parse("2026-09-20T12:56:51.179Z"));
    }

    @Test
    @DisplayName("returns the history as a JSON array in snake_case")
    void returnsHistoryInSnakeCase() throws Exception {
        when(messageService.history(eq(SENDER), eq(ROOM), any(), any())).thenReturn(List.of(message("hello")));

        mockMvc.perform(authenticatedGet("/rooms/42/messages"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$[0].content").value("hello"))
                .andExpect(jsonPath("$[0].room_id").value(42))
                .andExpect(jsonPath("$[0].sender_id").value(SENDER))
                .andExpect(jsonPath("$[0].content_type").value("text"))
                .andExpect(jsonPath("$[0].created_at").exists())
                .andExpect(jsonPath("$[0].deleted").value(false))
                // camelCase must not leak into the API
                .andExpect(jsonPath("$[0].roomId").doesNotExist())
                // deleted_at is internal and never exposed
                .andExpect(jsonPath("$[0].deleted_at").doesNotExist());
    }

    @Test
    @DisplayName("a deleted message keeps its place but hides its content")
    void deletedMessageHidesContent() throws Exception {
        Message deleted = message("secret");
        deleted.markDeleted(Instant.parse("2026-09-20T13:00:00Z"));
        when(messageService.history(eq(SENDER), eq(ROOM), any(), any())).thenReturn(List.of(deleted));

        mockMvc.perform(authenticatedGet("/rooms/42/messages"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].deleted").value(true))
                .andExpect(jsonPath("$[0].content").doesNotExist());
    }

    @Test
    @DisplayName("passes before and limit through to the service")
    void passesQueryParametersThrough() throws Exception {
        when(messageService.history(eq(SENDER), eq(ROOM), any(), any())).thenReturn(List.of());

        mockMvc.perform(authenticatedGet("/rooms/42/messages")
                        .param("before", "6a75d60a586b1c7be1750ad3")
                        .param("limit", "10"))
                .andExpect(status().isOk());

        ArgumentCaptor<String> before = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Integer> limit = ArgumentCaptor.forClass(Integer.class);
        org.mockito.Mockito.verify(messageService)
                .history(eq(SENDER), eq(ROOM), before.capture(), limit.capture());

        org.assertj.core.api.Assertions.assertThat(before.getValue())
                .isEqualTo("6a75d60a586b1c7be1750ad3");
        org.assertj.core.api.Assertions.assertThat(limit.getValue()).isEqualTo(10);
    }

    @Test
    @DisplayName("an ApiException comes back in the spec's error envelope")
    void errorsUseTheSpecEnvelope() throws Exception {
        when(messageService.history(eq(SENDER), eq(ROOM), any(), any()))
                .thenThrow(new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CURSOR",
                        "'before' is not a valid message id"));

        mockMvc.perform(authenticatedGet("/rooms/42/messages").param("before", "junk"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"))
                .andExpect(jsonPath("$.error.message").value("'before' is not a valid message id"));
    }

    @Test
    @DisplayName("a non-numeric room id is a 400 in the envelope, not a 500")
    void nonNumericRoomIdIsBadRequest() throws Exception {
        mockMvc.perform(authenticatedGet("/rooms/not-a-number/messages"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
    }

    @Test
    @DisplayName("an unexpected failure returns 500 without leaking internals")
    void unexpectedFailureIsOpaque() throws Exception {
        when(messageService.history(eq(SENDER), eq(ROOM), any(), any()))
                .thenThrow(new IllegalStateException("mongo credentials rejected at 10.0.0.5"));

        mockMvc.perform(authenticatedGet("/rooms/42/messages"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.error.message").value("Unexpected error"));
    }

    @Test
    @DisplayName("no authenticated user attribute: the request fails closed and never reaches the service")
    void requiresTheAuthenticatedUserAttribute() throws Exception {
        // In production AuthenticationFilter always sets the attribute, so this
        // can only happen through a misconfiguration. Spring cannot bind the
        // required parameter and the request is rejected as a 500 before the
        // controller body runs. The status is unhelpful, but the important
        // property holds: it fails CLOSED — no history is returned.
        mockMvc.perform(get("/rooms/42/messages"))
                .andExpect(status().is5xxServerError());

        org.mockito.Mockito.verifyNoInteractions(messageService);
    }
}
