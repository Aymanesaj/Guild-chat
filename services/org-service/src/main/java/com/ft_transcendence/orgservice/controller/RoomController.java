package com.ft_transcendence.orgservice.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
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
import com.ft_transcendence.orgservice.dto.UpdateRoomRequest;
import com.ft_transcendence.orgservice.model.RoleName;
import com.ft_transcendence.orgservice.dto.UpdateMemberRoleRequest;

@RestController
@RequestMapping("/rooms")
public class RoomController {
    private final RoomService roomService;

    public RoomController(RoomService roomService) {
        this.roomService = roomService;        
    }

    @GetMapping("/dm")
    public List<RoomResponse> getDirectMessageRooms(Principal principal) {
        UUID userId = UUID.fromString(principal.getName());
        return roomService.getDirectMessageRoomsByUserId(userId);
    }

    @PatchMapping("/{roomId}/members/{userId}/roles")
    public ResponseEntity<Void> updateMemberRole(
            @PathVariable Long roomId,
            @PathVariable UUID userId,
            @Valid @RequestBody UpdateMemberRoleRequest request,
            Principal principal
    ) {
        UUID actorId = UUID.fromString(principal.getName());
        roomService.updateMemberRole(roomId, userId, request.roleName(), actorId);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{roomId}")
    public RoomResponse updateRoom(
            @PathVariable Long roomId,
            @Valid @RequestBody UpdateRoomRequest request,
            Principal principal
    ) {
        UUID userId = UUID.fromString(principal.getName());
        return roomService.updateRoom(roomId, request, userId);
    }

    @GetMapping("/{roomId}/roles")
    public List<RoleName> getRoles(@PathVariable Long roomId, Principal principal) {
        UUID userId = UUID.fromString(principal.getName());
        return roomService.getRolesByRoomId(roomId, userId);
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
        roomService.addMember(roomId, actorId, request.userId());
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

    @PostMapping("/{roomId}/read")
    public ResponseEntity<Void> markRoomAsRead(@PathVariable Long roomId, Principal principal) {
        UUID userId = UUID.fromString(principal.getName());
        roomService.markRoomAsRead(roomId, userId);
        return ResponseEntity.noContent().build();
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

    @DeleteMapping("/{roomId}/members/me")
    public ResponseEntity<Void> leaveRoom(@PathVariable Long roomId, Principal principal) {
        UUID userId = UUID.fromString(principal.getName());
        roomService.leaveRoom(roomId, userId);
        return ResponseEntity.noContent().build();
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

    @DeleteMapping("/{roomId}")
    public ResponseEntity<Void> deleteRoom(@PathVariable Long roomId, Principal principal) {
        UUID userId = UUID.fromString(principal.getName());
        roomService.deleteRoom(roomId, userId);
        return ResponseEntity.noContent().build();
    }
}
