package com.fttranscendence.identity.controller;

import com.fttranscendence.identity.dto.FriendRequestResponse;
import com.fttranscendence.identity.dto.SendFriendRequest;
import com.fttranscendence.identity.dto.UserResponse;
import com.fttranscendence.identity.model.FriendshipEntity;
import com.fttranscendence.identity.security.CurrentUser;
import com.fttranscendence.identity.service.FriendService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/friends")
public class FriendController {
	private final FriendService friendService;

	public FriendController(FriendService friendService) {
		this.friendService = friendService;
	}

	@PostMapping("/requests")
	public FriendRequestResponse sendRequest(@Valid @RequestBody SendFriendRequest request) {
		return FriendRequestResponse.from(
			friendService.sendRequest(CurrentUser.id(), request.addresseeId())
		);
	}

	@PostMapping("/requests/{id}/accept")
	public FriendRequestResponse accept(@PathVariable UUID id) {
		return FriendRequestResponse.from(friendService.accept(CurrentUser.id(), id));
	}

	@PostMapping("/requests/{id}/decline")
	public Map<String, String> decline(@PathVariable UUID id) {
		friendService.decline(CurrentUser.id(), id);
		return Map.of("status", "declined");
	}

	@DeleteMapping("/{userId}")
	public Map<String, String> remove(@PathVariable UUID userId) {
		friendService.remove(CurrentUser.id(), userId);
		return Map.of("status", "removed");
	}

	@GetMapping
	public List<UserResponse> listFriends() {
		return friendService.listFriends(CurrentUser.id()).stream()
			.map(UserResponse::from)
			.toList();
	}

	@GetMapping("/requests")
	public Map<String, List<FriendRequestResponse>> listPending() {
		List<FriendshipEntity> incoming = friendService.listPendingIncoming(CurrentUser.id());
		List<FriendshipEntity> outgoing = friendService.listPendingOutgoing(CurrentUser.id());
		return Map.of(
			"incoming", incoming.stream().map(FriendRequestResponse::from).toList(),
			"outgoing", outgoing.stream().map(FriendRequestResponse::from).toList()
		);
	}
}
