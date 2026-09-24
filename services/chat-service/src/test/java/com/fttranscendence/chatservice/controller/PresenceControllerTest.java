package com.fttranscendence.chatservice.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.websocket.PresenceRegistry;

/** GET /presence: parameter parsing, limits and the response shape. */
@WebMvcTest(PresenceController.class)
@AutoConfigureMockMvc(addFilters = false) // the filter has its own test; this slice is the controller
class PresenceControllerTest {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PresenceRegistry presenceRegistry;

    /** @WebMvcTest includes Filter beans, so AuthenticationFilter's dependency must exist. */
    @MockBean
    private IdentityClient identityClient;

    private static Map<String, String> statuses(String... pairs) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            map.put(pairs[i], pairs[i + 1]);
        }
        return map;
    }

    @Test
    @DisplayName("returns a user id → status object")
    void returnsStatusesById() throws Exception {
        when(presenceRegistry.statuses(List.of(ALICE, BOB)))
                .thenReturn(statuses(ALICE, "online", BOB, "offline"));

        mockMvc.perform(get("/presence").param("ids", ALICE + "," + BOB))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$['" + ALICE + "']").value("online"))
                .andExpect(jsonPath("$['" + BOB + "']").value("offline"));
    }

    @Test
    @DisplayName("repeated ?ids= parameters work like a comma list")
    void acceptsRepeatedParameters() throws Exception {
        when(presenceRegistry.statuses(List.of(ALICE, BOB))).thenReturn(statuses(ALICE, "online", BOB, "online"));

        mockMvc.perform(get("/presence").param("ids", ALICE).param("ids", BOB))
                .andExpect(status().isOk());

        verify(presenceRegistry).statuses(List.of(ALICE, BOB));
    }

    @Test
    @DisplayName("blanks and duplicates are dropped before asking the registry")
    void trimsAndDedupes() throws Exception {
        when(presenceRegistry.statuses(List.of(ALICE, BOB))).thenReturn(statuses(ALICE, "online", BOB, "online"));

        mockMvc.perform(get("/presence").param("ids", " " + ALICE + " ,," + BOB + "," + ALICE))
                .andExpect(status().isOk());

        verify(presenceRegistry).statuses(List.of(ALICE, BOB));
    }

    @Test
    @DisplayName("no ids parameter is a 400 MISSING_IDS, not a 500")
    void missingIdsIsBadRequest() throws Exception {
        mockMvc.perform(get("/presence"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("MISSING_IDS"));

        verifyNoInteractions(presenceRegistry);
    }

    @Test
    @DisplayName("an ids parameter with only commas and spaces is a 400 MISSING_IDS")
    void blankIdsIsBadRequest() throws Exception {
        mockMvc.perform(get("/presence").param("ids", " , ,"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("MISSING_IDS"));
    }

    @Test
    @DisplayName("100 ids are accepted; 101 are a 400 TOO_MANY_IDS")
    void idLimitBoundary() throws Exception {
        when(presenceRegistry.statuses(any())).thenReturn(Map.of());
        String hundred = IntStream.range(0, 100).mapToObj(i -> "u" + i).collect(Collectors.joining(","));

        mockMvc.perform(get("/presence").param("ids", hundred))
                .andExpect(status().isOk());
        mockMvc.perform(get("/presence").param("ids", hundred + ",u100"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("TOO_MANY_IDS"));
    }
}
