package com.fttranscendence.chatservice.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.model.Notification;
import com.fttranscendence.chatservice.service.NotificationService;

/** /notifications: JSON shape and error envelope. Rules are in NotificationServiceTest. */
@WebMvcTest(NotificationController.class)
@AutoConfigureMockMvc(addFilters = false) // AuthenticationFilter has its own test
class NotificationControllerTest {

    private static final String USER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    private static final String ID = "66f0c1a2b3c4d5e6f7a8b9c0";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private NotificationService notificationService;

    /** @WebMvcTest includes Filter beans, so AuthenticationFilter's dependency must exist. */
    @MockBean
    private IdentityClient identityClient;

    @Test
    @DisplayName("GET: newest first, snake_case, read as a boolean, no internal fields")
    void lists() throws Exception {
        Notification notification = new Notification(ID, USER, Notification.ROLE_CHANGED, BOB, 42L, "ADMIN", null,
                "source", Instant.parse("2026-10-25T10:00:00Z"), null);
        when(notificationService.list(USER, null, null)).thenReturn(List.of(notification));

        mockMvc.perform(get("/notifications").requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(ID))
                .andExpect(jsonPath("$[0].type").value("ROLE_CHANGED"))
                .andExpect(jsonPath("$[0].actor_id").value(BOB))
                .andExpect(jsonPath("$[0].room_id").value(42))
                .andExpect(jsonPath("$[0].role").value("ADMIN"))
                .andExpect(jsonPath("$[0].created_at").exists())
                .andExpect(jsonPath("$[0].read").value(false))
                .andExpect(jsonPath("$[0].source_id").doesNotExist())
                .andExpect(jsonPath("$[0].user_id").doesNotExist());
    }

    @Test
    @DisplayName("GET with a bad cursor keeps the error envelope")
    void badCursor() throws Exception {
        when(notificationService.list(USER, "nope", null))
                .thenThrow(ApiException.badRequest("INVALID_CURSOR", "'before' is not a valid notification id"));

        mockMvc.perform(get("/notifications?before=nope").requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
    }

    @Test
    @DisplayName("GET unread-count: { unread }")
    void unreadCount() throws Exception {
        when(notificationService.unreadCount(USER)).thenReturn(3);

        mockMvc.perform(get("/notifications/unread-count").requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unread").value(3));
    }

    @Test
    @DisplayName("PUT read: { ids, all: false, unread }")
    void marksRead() throws Exception {
        when(notificationService.markRead(USER, List.of(ID)))
                .thenReturn(new NotificationService.ReadResult(List.of(ID), false, 2));

        mockMvc.perform(put("/notifications/read")
                        .requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + ID + "\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ids[0]").value(ID))
                .andExpect(jsonPath("$.all").value(false))
                .andExpect(jsonPath("$.unread").value(2));
    }

    @Test
    @DisplayName("PUT read-all: { ids: null, all: true, unread }")
    void marksAllRead() throws Exception {
        when(notificationService.markAllRead(USER)).thenReturn(new NotificationService.ReadResult(null, true, 0));

        mockMvc.perform(put("/notifications/read-all").requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.all").value(true))
                .andExpect(jsonPath("$.unread").value(0));
    }
}
