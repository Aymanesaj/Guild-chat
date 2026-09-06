package com.fttranscendence.chatservice.message.service;

import com.fttranscendence.chatservice.message.domain.Room;
import com.fttranscendence.chatservice.message.repository.RoomRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.stream.Stream;

@Service
@RequiredArgsConstructor
public class RoomService {

    private final RoomRepository roomRepository;

    public Room getOrCreateDm(String userA, String userB) {
        List<String> sortedMembers = Stream.of(userA, userB).sorted().toList();

        return roomRepository
                .findByTypeAndMemberIds(Room.RoomType.DM, sortedMembers)
                .orElseGet(() -> roomRepository.save(
                        Room.builder()
                                .type(Room.RoomType.DM)
                                .memberIds(sortedMembers)
                                .createdAt(Instant.now())
                                .build()
                ));
    }

    public Room createGroup(String name, List<String> memberIds) {
        return roomRepository.save(
                Room.builder()
                        .type(Room.RoomType.GROUP)
                        .name(name)
                        .memberIds(memberIds)
                        .createdAt(Instant.now())
                        .build()
        );
    }

    public List<Room> getRoomsForUser(String userId) {
        return roomRepository.findByMemberIdsContaining(userId);
    }

    public boolean isMember(Room room, String userId) {
        return room.getMemberIds().contains(userId);
    }

    public Room getRoomOrThrow(String roomId) {
        return roomRepository.findById(roomId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
    }
}