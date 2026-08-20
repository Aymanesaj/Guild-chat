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

@RestController
@RequestMapping("/rooms")
public class RoomController {
    private final RoomService roomService;

    public RoomController(RoomService roomService) {
        this.roomService = roomService;        
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

    @PostMapping
    public RoomResponse createRoom(
            @Valid @RequestBody CreateRoomRequest request,
            Principal principal
    ) {
        UUID creatorId = UUID.fromString(principal.getName());
        return roomService.createRoom(request, creatorId);
    }
}
