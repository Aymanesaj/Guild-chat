package com.fttranscendence.chatservice.message.controller;

import com.fttranscendence.chatservice.message.domain.ChatMessage;
import com.fttranscendence.chatservice.message.domain.Room;
import com.fttranscendence.chatservice.message.dto.CreateDmRequest;
import com.fttranscendence.chatservice.message.dto.CreateGroupRequest;
import com.fttranscendence.chatservice.message.service.ChatMessageService;
import com.fttranscendence.chatservice.message.service.RoomService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RoomControllerTest {

    @Mock
    private RoomService roomService;
    @Mock
    private ChatMessageService chatMessageService;

    private RoomController controller;

    @BeforeEach
    void setUp() {
        controller = new RoomController(roomService, chatMessageService);
    }

    @Test
    void getMyRooms_returnsRoomsForAuthenticatedUser() {
        Room room = Room.builder().id("room-1").build();
        when(roomService.getRoomsForUser("user-1")).thenReturn(List.of(room));

        List<Room> result = controller.getMyRooms("user-1");

        assertThat(result).containsExactly(room);
    }

    @Test
    void getOrCreateDm_delegatesToService_withCallerAsFirstParticipant() {
        Room room = Room.builder().id("room-1").build();
        when(roomService.getOrCreateDm("user-1", "user-2")).thenReturn(room);

        Room result = controller.getOrCreateDm("user-1", new CreateDmRequest("user-2"));

        assertThat(result).isSameAs(room);
    }

    @Test
    void createGroup_includesCallerInMemberList() {
        when(roomService.createGroup(eq("squad"), anyList()))
                .thenAnswer(inv -> Room.builder().id("g1").name(inv.getArgument(0))
                        .memberIds(inv.getArgument(1)).build());

        Room result = controller.createGroup("user-1", new CreateGroupRequest("squad", List.of("user-2", "user-3")));

        assertThat(result.getMemberIds()).containsExactlyInAnyOrder("user-1", "user-2", "user-3");
    }

    @Test
    void getHistory_returnsMessages_whenCallerIsMember() {
        Room room = Room.builder().id("room-1").memberIds(List.of("user-1")).build();
        ChatMessage message = ChatMessage.builder().id("m1").roomId("room-1").build();

        when(roomService.getRoomOrThrow("room-1")).thenReturn(room);
        when(roomService.isMember(room, "user-1")).thenReturn(true);
        when(chatMessageService.getHistory("room-1", 0, 50)).thenReturn(List.of(message));

        List<ChatMessage> result = controller.getHistory("user-1", "room-1", 0, 50);

        assertThat(result).containsExactly(message);
    }

    @Test
    void getHistory_throwsForbidden_whenCallerIsNotMember() {
        Room room = Room.builder().id("room-1").memberIds(List.of("someone-else")).build();

        when(roomService.getRoomOrThrow("room-1")).thenReturn(room);
        when(roomService.isMember(room, "user-1")).thenReturn(false);

        assertThatThrownBy(() -> controller.getHistory("user-1", "room-1", 0, 50))
                .isInstanceOf(ResponseStatusException.class)
                .hasFieldOrPropertyWithValue("statusCode", HttpStatus.FORBIDDEN);

        verifyNoInteractions(chatMessageService);
    }
}
