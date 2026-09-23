package com.fttranscendence.chatservice.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.service.MessageService;

/**
 * The HTTP surface of /messages/{id}: routing, status codes, JSON shape and
 * error envelope. The service is mocked; its rules are in MessageServiceTest.
 */
@WebMvcTest(MessageItemController.class)
@AutoConfigureMockMvc(addFilters = false) // the filter has its own test; this slice is the controller
class MessageItemControllerTest {

    private static final long ROOM = 42L;
    private static final String USER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String MESSAGE_ID = "6a75d60a586b1c7be1750ad3";

    /** A @WebMvcTest slice runs no filters, so the attribute AuthenticationFilter sets is set by hand. */
    private static MockHttpServletRequestBuilder authenticatedGet(String path) {
        return get(path).requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER);
    }

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private MessageService messageService;

    /** @WebMvcTest includes Filter beans, so AuthenticationFilter's dependency must exist. */
    @MockBean
    private IdentityClient identityClient;

    private Message message(String content) {
        return Message.create(ROOM, USER, null, content, "text",
                Instant.parse("2026-09-20T12:56:51.179Z"));
    }

    @Test
    @DisplayName("returns the message in snake_case, the same shape as history")
    void returnsMessageInSnakeCase() throws Exception {
        when(messageService.get(USER, MESSAGE_ID)).thenReturn(message("hello"));

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("hello"))
                .andExpect(jsonPath("$.room_id").value(42))
                .andExpect(jsonPath("$.sender_id").value(USER))
                .andExpect(jsonPath("$.content_type").value("text"))
                .andExpect(jsonPath("$.created_at").value("2026-09-20T12:56:51.179Z"))
                .andExpect(jsonPath("$.deleted").value(false))
                .andExpect(jsonPath("$.roomId").doesNotExist())
                .andExpect(jsonPath("$.deleted_at").doesNotExist());
    }

    @Test
    @DisplayName("passes the path id and the authenticated user to the service")
    void passesPathIdAndUser() throws Exception {
        when(messageService.get(USER, MESSAGE_ID)).thenReturn(message("hello"));

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isOk());

        verify(messageService).get(USER, MESSAGE_ID);
    }

    @Test
    @DisplayName("a deleted message is 200 with deleted=true and no content")
    void deletedMessageHidesContent() throws Exception {
        Message deleted = message("secret");
        deleted.markDeleted(Instant.parse("2026-09-20T13:00:00Z"));
        when(messageService.get(USER, MESSAGE_ID)).thenReturn(deleted);

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true))
                .andExpect(jsonPath("$.content").doesNotExist());
    }

    @Test
    @DisplayName("MESSAGE_NOT_FOUND comes back as 404 in the spec envelope")
    void notFoundUsesEnvelope() throws Exception {
        when(messageService.get(USER, MESSAGE_ID)).thenThrow(
                ApiException.notFound("MESSAGE_NOT_FOUND", "Message does not exist"));

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MESSAGE_NOT_FOUND"))
                .andExpect(jsonPath("$.error.message").value("Message does not exist"));
    }

    @Test
    @DisplayName("INVALID_MESSAGE_ID comes back as 400 in the spec envelope")
    void invalidIdUsesEnvelope() throws Exception {
        when(messageService.get(USER, "junk")).thenThrow(
                ApiException.badRequest("INVALID_MESSAGE_ID", "'id' is not a valid message id"));

        mockMvc.perform(authenticatedGet("/messages/junk"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_MESSAGE_ID"));
    }

    @Test
    @DisplayName("org-service down is a 503 ORG_UNAVAILABLE")
    void orgOutageIsServiceUnavailable() throws Exception {
        when(messageService.get(USER, MESSAGE_ID)).thenThrow(new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "ORG_UNAVAILABLE", "org-service is unavailable"));

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("ORG_UNAVAILABLE"));
    }

    @Test
    @DisplayName("no authenticated user attribute: fails closed, the service is never called")
    void requiresTheAuthenticatedUserAttribute() throws Exception {
        mockMvc.perform(get("/messages/" + MESSAGE_ID))
                .andExpect(status().is5xxServerError());

        verifyNoInteractions(messageService);
    }
}
