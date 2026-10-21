package com.ft_transcendence.orgservice.controller;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import com.ft_transcendence.orgservice.dto.CreateRoomRequest;
import com.ft_transcendence.orgservice.dto.RoomResponse;
import com.ft_transcendence.orgservice.dto.UpdateRoomRequest;
import com.ft_transcendence.orgservice.model.RoomType;
import com.ft_transcendence.orgservice.service.RoomService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RoomDescriptionControllerTest {
    private final UUID user = UUID.randomUUID();
    private RoomService service;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        service = mock(RoomService.class);
        mvc = MockMvcBuilders.standaloneSetup(new RoomController(service)).build();
    }

    @Test
    void createAndUpdateAcceptAndReturn500CharacterDescriptions() throws Exception {
        String description = "d".repeat(500);
        var response = new RoomResponse(1L, "room", description, null, RoomType.GROUP, null, null);
        when(service.createRoom(new CreateRoomRequest("room", description), user)).thenReturn(response);
        when(service.updateRoom(1L, new UpdateRoomRequest("room", description), user)).thenReturn(response);
        for (var request : new org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder[] {
                post("/rooms"), patch("/rooms/1")}) {
            mvc.perform(request.principal(() -> user.toString()).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"room\",\"description\":\"" + description + "\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.description").value(description));
        }
    }

    @Test
    void createAndUpdateRejectDescriptionsOver500CharactersBeforeCallingService() throws Exception {
        for (var request : new org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder[] {
                post("/rooms"), patch("/rooms/1")}) {
            mvc.perform(request.principal(() -> user.toString()).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"room\",\"description\":\"" + "d".repeat(501) + "\"}"))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service);
    }

    @Test
    void oldRequestsWithoutDescriptionRemainValid() throws Exception {
        mvc.perform(post("/rooms").principal(() -> user.toString()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"room\"}")).andExpect(status().isOk());
        verify(service).createRoom(new CreateRoomRequest("room", null), user);
        mvc.perform(patch("/rooms/1").principal(() -> user.toString()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"room\"}")).andExpect(status().isOk());
        verify(service).updateRoom(1L, new UpdateRoomRequest("room", null), user);
    }
}
