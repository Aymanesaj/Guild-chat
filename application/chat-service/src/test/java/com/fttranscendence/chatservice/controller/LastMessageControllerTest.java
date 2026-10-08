package com.fttranscendence.chatservice.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
 * GET /rooms/last-messages: status codes, JSON shape, error envelope.
 * The service is mocked; the rules are in MessageServiceTest, the query in
 * MessageRepositoryTest.
 */
@WebMvcTest(LastMessageController.class)
@AutoConfigureMockMvc(addFilters = false) // AuthenticationFilter has its own test
class LastMessageControllerTest {

    private static final String USER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private MessageService messageService;

    /** @WebMvcTest includes Filter beans, so AuthenticationFilter's dependency must exist. */
    @MockBean
    private IdentityClient identityClient;

    private static MockHttpServletRequestBuilder authenticatedGet(String path) {
        return get(path).requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER);
    }

    private static Message message(long roomId, String content) {
        return Message.create(roomId, USER, null, content, "text", Instant.parse("2026-09-28T10:00:00Z"));
    }

    @Test
    @DisplayName("200: an object keyed by room id, each value the usual snake_case message")
    void returnsMessagesKeyedByRoom() throws Exception {
        Map<Long, Message> latest = new LinkedHashMap<>();
        latest.put(3L, message(3L, "hello"));
        latest.put(7L, null);
        when(messageService.latestMessages(USER, List.of(3L, 7L))).thenReturn(latest);

        mockMvc.perform(authenticatedGet("/rooms/last-messages?ids=3,7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isMap())
                .andExpect(jsonPath("$['3'].content").value("hello"))
                .andExpect(jsonPath("$['3'].room_id").value(3))
                .andExpect(jsonPath("$['3'].created_at").exists())
                .andExpect(jsonPath("$['3'].roomId").doesNotExist())
                // a room with no messages is present, with null
                .andExpect(jsonPath("$.['7']").hasJsonPath())
                .andExpect(jsonPath("$['7']").isEmpty());
    }

    @Test
    @DisplayName("a deleted newest message is sent as deleted, with its content hidden")
    void deletedPreviewHidesContent() throws Exception {
        Message deleted = message(3L, "secret");
        deleted.markDeleted(Instant.parse("2026-09-28T10:01:00Z"));
        when(messageService.latestMessages(USER, List.of(3L))).thenReturn(Map.of(3L, deleted));

        mockMvc.perform(authenticatedGet("/rooms/last-messages?ids=3"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$['3'].deleted").value(true))
                .andExpect(jsonPath("$['3'].content").doesNotExist());
    }

    @Test
    @DisplayName("?ids=3&ids=7 works like ?ids=3,7")
    void repeatedParameterWorks() throws Exception {
        when(messageService.latestMessages(eq(USER), any())).thenReturn(Map.of());

        mockMvc.perform(authenticatedGet("/rooms/last-messages?ids=3&ids=7"))
                .andExpect(status().isOk());

        verify(messageService).latestMessages(USER, List.of(3L, 7L));
    }

    @Test
    @DisplayName("no ids parameter at all is a 400 MISSING_IDS in the error envelope, not a 500")
    void missingParameterIs400() throws Exception {
        when(messageService.latestMessages(eq(USER), any())).thenThrow(
                ApiException.badRequest("MISSING_IDS", "'ids' must list at least one room id"));

        mockMvc.perform(authenticatedGet("/rooms/last-messages"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("MISSING_IDS"));
    }

    @Test
    @DisplayName("a non-numeric id is a 400 INVALID_PARAMETER, and the service is never called")
    void nonNumericIdIs400() throws Exception {
        mockMvc.perform(authenticatedGet("/rooms/last-messages?ids=3,abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));

        verifyNoInteractions(messageService);
    }

    @Test
    @DisplayName("service errors keep their status and code (e.g. 503 ORG_UNAVAILABLE)")
    void serviceErrorsPassThrough() throws Exception {
        when(messageService.latestMessages(eq(USER), any())).thenThrow(
                new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ORG_UNAVAILABLE", "org-service is unavailable"));

        mockMvc.perform(authenticatedGet("/rooms/last-messages?ids=3"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("ORG_UNAVAILABLE"));
    }

    @Test
    @DisplayName("does not clash with /rooms/{roomId}/messages")
    void noRouteClash() throws Exception {
        when(messageService.latestMessages(eq(USER), any())).thenReturn(Map.of());

        mockMvc.perform(authenticatedGet("/rooms/last-messages?ids=3"))
                .andExpect(status().isOk());

        verify(messageService).latestMessages(USER, List.of(3L));
    }
}
