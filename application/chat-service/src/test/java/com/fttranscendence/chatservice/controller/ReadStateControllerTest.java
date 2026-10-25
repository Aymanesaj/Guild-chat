package com.fttranscendence.chatservice.controller;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
import com.fttranscendence.chatservice.service.ReadStateService;

/** PUT /rooms/{id}/read and GET /rooms/unread: JSON shape and error envelope. Rules are in ReadStateServiceTest. */
@WebMvcTest(ReadStateController.class)
@AutoConfigureMockMvc(addFilters = false) // AuthenticationFilter has its own test
class ReadStateControllerTest {

    private static final String USER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String MESSAGE_ID = "66f0c1a2b3c4d5e6f7a8b9c0";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ReadStateService readStateService;

    /** @WebMvcTest includes Filter beans, so AuthenticationFilter's dependency must exist. */
    @MockBean
    private IdentityClient identityClient;

    private org.springframework.test.web.servlet.ResultActions putRead(String json) throws Exception {
        return mockMvc.perform(put("/rooms/42/read")
                .requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }

    @Test
    @DisplayName("PUT read: 200 with the mark and what is left unread, snake_case")
    void marksRead() throws Exception {
        when(readStateService.markRead(USER, 42L, MESSAGE_ID))
                .thenReturn(new ReadStateService.ReadMark(42L, MESSAGE_ID, 3));

        putRead("{\"message_id\":\"" + MESSAGE_ID + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.room_id").value(42))
                .andExpect(jsonPath("$.last_read_id").value(MESSAGE_ID))
                .andExpect(jsonPath("$.unread").value(3))
                .andExpect(jsonPath("$.lastReadId").doesNotExist());
    }

    @Test
    @DisplayName("PUT read without message_id: 400 VALIDATION_ERROR, the service is not called")
    void requiresMessageId() throws Exception {
        putRead("{}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.error.details.message_id").exists());
        verifyNoInteractions(readStateService);
    }

    @Test
    @DisplayName("PUT read: service refusals keep the error envelope")
    void refusalsUseTheEnvelope() throws Exception {
        when(readStateService.markRead(USER, 42L, MESSAGE_ID))
                .thenThrow(ApiException.forbidden("NOT_A_MEMBER", "User is not a member of the room"));

        putRead("{\"message_id\":\"" + MESSAGE_ID + "\"}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("NOT_A_MEMBER"));
    }

    @Test
    @DisplayName("GET unread: an object of counts keyed by room id")
    void unreadCounts() throws Exception {
        Map<Long, Integer> counts = new LinkedHashMap<>();
        counts.put(3L, 5);
        counts.put(7L, 0);
        when(readStateService.unreadCounts(USER, List.of(3L, 7L))).thenReturn(counts);

        mockMvc.perform(get("/rooms/unread?ids=3,7").requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$['3']").value(5))
                .andExpect(jsonPath("$['7']").value(0));
    }

    @Test
    @DisplayName("GET unread with a non-numeric id: 400 INVALID_PARAMETER")
    void badId() throws Exception {
        mockMvc.perform(get("/rooms/unread?ids=abc").requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
    }
}
