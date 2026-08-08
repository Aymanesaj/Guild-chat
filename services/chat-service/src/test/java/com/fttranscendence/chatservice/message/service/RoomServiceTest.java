package com.fttranscendence.chatservice.message.service;

import com.fttranscendence.chatservice.message.domain.Room;
import com.fttranscendence.chatservice.message.repository.RoomRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RoomServiceTest {

    @Mock
    private RoomRepository roomRepository;

    private RoomService roomService;

    @BeforeEach
    void setUp() {
        roomService = new RoomService(roomRepository);
    }

    @Test
    void getOrCreateDm_returnsExistingRoom_whenAlreadyPresent() {
        Room existing = Room.builder().id("room-1").type(Room.RoomType.DM)
                .memberIds(List.of("userA", "userB")).build();
        when(roomRepository.findByTypeAndMemberIds(Room.RoomType.DM, List.of("userA", "userB")))
                .thenReturn(Optional.of(existing));

        Room result = roomService.getOrCreateDm("userB", "userA");

        assertThat(result).isSameAs(existing);
        verify(roomRepository, never()).save(any());
    }

    @Test
    void getOrCreateDm_sortsMemberIds_soOrderOfArgumentsDoesNotMatter() {
        when(roomRepository.findByTypeAndMemberIds(eq(Room.RoomType.DM), eq(List.of("userA", "userB"))))
                .thenReturn(Optional.empty());
        when(roomRepository.save(any(Room.class))).thenAnswer(inv -> inv.getArgument(0));

        Room result = roomService.getOrCreateDm("userB", "userA");

        assertThat(result.getMemberIds()).containsExactly("userA", "userB");
        assertThat(result.getType()).isEqualTo(Room.RoomType.DM);
    }

    @Test
    void createGroup_savesRoomWithNameAndMembers() {
        when(roomRepository.save(any(Room.class))).thenAnswer(inv -> inv.getArgument(0));

        Room result = roomService.createGroup("squad", List.of("u1", "u2", "u3"));

        assertThat(result.getType()).isEqualTo(Room.RoomType.GROUP);
        assertThat(result.getName()).isEqualTo("squad");
        assertThat(result.getMemberIds()).containsExactly("u1", "u2", "u3");
    }

    @Test
    void isMember_true_whenUserInMemberList() {
        Room room = Room.builder().memberIds(List.of("u1", "u2")).build();
        assertThat(roomService.isMember(room, "u1")).isTrue();
        assertThat(roomService.isMember(room, "u3")).isFalse();
    }

    @Test
    void getRoomOrThrow_throws404_whenRoomMissing() {
        when(roomRepository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> roomService.getRoomOrThrow("missing"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("Room not found");
    }
}
