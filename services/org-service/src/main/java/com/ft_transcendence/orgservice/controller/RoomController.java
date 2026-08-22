package com.ft_transcendence.orgservice.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import jakarta.validation.Valid;
import com.ft_transcendence.orgservice.service.RoomService;
import com.ft_transcendence.orgservice.dto.CreateRoomRequest;
import com.ft_transcendence.orgservice.dto.RoomResponse;
import org.springframework.web.bind.annotation.PathVariable;
import java.util.List;
import java.security.Principal;
import java.util.UUID;
import com.ft_transcendence.orgservice.dto.AddMemberRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import com.ft_transcendence.orgservice.dto.CreateDirectMessageRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import com.ft_transcendence.orgservice.dto.MemberResponse;

@RestController
@RequestMapping("/rooms")
public class RoomController {
    private final RoomService roomService;

    public RoomController(RoomService roomService) {
        this.roomService = roomService;        
    }

    @GetMapping("{roomId}/members")
    public List<MemberResponse> getMembers(@PathVariable Long roomId, Principal principal) {
        UUID userId = UUID.fromString(principal.getName());
        return roomService.getMembersByRoomId(roomId, userId);
    }

    @PostMapping("/{roomId}/members")
    public ResponseEntity<Void> addMember(
            @PathVariable Long roomId,
            @Valid @RequestBody AddMemberRequest request,
            Principal principal
    ) {
        UUID actorId = UUID.fromString(principal.getName());
        roomService.addMember(roomId, actorId, request.UserId());
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @GetMapping
    public List<RoomResponse> getRoomsByUserId(Principal principal) {
        UUID userId = UUID.fromString(principal.getName());
        return roomService.getRoomsByUserId(userId);
    }

    @GetMapping("/{id}")
    public RoomResponse getRoomById(@PathVariable Long id, Principal principal) {
        UUID userId = UUID.fromString(principal.getName());
        return roomService.getRoomById(id, userId);
    }

    @PostMapping("/dm")
    public RoomResponse createDirectMessageRoom(
            @Valid @RequestBody CreateDirectMessageRequest request,
            Principal principal
    ) {
        UUID creatorId = UUID.fromString(principal.getName());
        return roomService.createDirectMessageRoom(
                creatorId,
                request.userId()
        );
    }

    @PostMapping
    public RoomResponse createRoom(
            @Valid @RequestBody CreateRoomRequest request,
            Principal principal
    ) {
        UUID creatorId = UUID.fromString(principal.getName());
        return roomService.createRoom(request, creatorId);
    }

    @DeleteMapping("/{roomId}/members/{userId}")
    public ResponseEntity<Void> removeMember(
            @PathVariable Long roomId,
            @PathVariable UUID userId,
            Principal principal
    ) {
        UUID actorId = UUID.fromString(principal.getName());
        roomService.removeMember(roomId, actorId, userId);
        return ResponseEntity.noContent().build();
    }
}
