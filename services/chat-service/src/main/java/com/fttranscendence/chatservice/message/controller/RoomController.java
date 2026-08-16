package com.fttranscendence.chatservice.message.controller;

import com.fttranscendence.chatservice.message.domain.ChatMessage;
import com.fttranscendence.chatservice.message.domain.Room;
import com.fttranscendence.chatservice.message.dto.CreateDmRequest;
import com.fttranscendence.chatservice.message.dto.CreateGroupRequest;
import com.fttranscendence.chatservice.message.dto.RoomMemberResponse;
import com.fttranscendence.chatservice.message.service.ChatMessageService;
import com.fttranscendence.chatservice.message.service.RoomService;
import com.fttranscendence.chatservice.websocket.SessionRegistry;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api/rooms")
@RequiredArgsConstructor
public class RoomController {

    private final RoomService roomService;
    private final ChatMessageService chatMessageService;
    private final SessionRegistry sessionRegistry;

    @GetMapping
    public List<Room> getMyRooms(@RequestAttribute("userId") String userId) {
        return roomService.getRoomsForUser(userId);
    }

    @PostMapping("/dm")
    @ResponseStatus(HttpStatus.OK)
    public Room getOrCreateDm(@RequestAttribute("userId") String userId,
                               @Valid @RequestBody CreateDmRequest request) {
        return roomService.getOrCreateDm(userId, request.getTargetUserId());
    }

    @PostMapping("/group")
    @ResponseStatus(HttpStatus.CREATED)
    public Room createGroup(@RequestAttribute("userId") String userId,
                             @Valid @RequestBody CreateGroupRequest request) {
        List<String> members = Stream.concat(
                Stream.of(userId),
                request.getMemberIds().stream()
        ).distinct().toList();

        return roomService.createGroup(request.getName(), members);
    }

    @GetMapping("/{roomId}/messages")
    public List<ChatMessage> getHistory(@RequestAttribute("userId") String userId,
                                         @PathVariable String roomId,
                                         @RequestParam(defaultValue = "0") int page,
                                         @RequestParam(defaultValue = "50") int size) {
        Room room = roomService.getRoomOrThrow(roomId);
        if (!roomService.isMember(room, userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not a member of this room");
        }
        return chatMessageService.getHistory(roomId, page, size);
    }

    @GetMapping("/{roomId}/members")
    public List<RoomMemberResponse> getMembers(@RequestAttribute("userId") String userId,
                                                @PathVariable String roomId) {
        Room room = roomService.getRoomOrThrow(roomId);
        if (!roomService.isMember(room, userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not a member of this room");
        }
        return room.getMemberIds().stream()
                .map(memberId -> new RoomMemberResponse(memberId, sessionRegistry.isOnline(memberId)))
                .toList();
    }
}
