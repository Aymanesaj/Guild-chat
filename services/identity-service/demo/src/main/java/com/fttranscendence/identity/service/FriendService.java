package com.fttranscendence.identity.service;

import com.fttranscendence.identity.exception.ApiRequestException;
import com.fttranscendence.identity.model.FriendshipEntity;
import com.fttranscendence.identity.model.FriendshipStatus;
import com.fttranscendence.identity.model.UserEntity;
import com.fttranscendence.identity.repository.FriendshipRepository;
import com.fttranscendence.identity.repository.UserRepository;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FriendService {
	private final FriendshipRepository friendshipRepository;
	private final UserRepository userRepository;

	public FriendService(FriendshipRepository friendshipRepository, UserRepository userRepository) {
		this.friendshipRepository = friendshipRepository;
		this.userRepository = userRepository;
	}

	@Transactional
	public FriendshipEntity sendRequest(UUID requesterId, UUID addresseeId) {
		if (requesterId.equals(addresseeId)) {
			throw new ApiRequestException(HttpStatus.BAD_REQUEST, "Cannot send a friend request to yourself");
		}
		userRepository.findById(addresseeId)
			.orElseThrow(() -> new ApiRequestException(HttpStatus.NOT_FOUND, "User not found"));

		friendshipRepository.findBetween(requesterId, addresseeId).ifPresent(existing -> {
			switch (existing.getStatus()) {
				case ACCEPTED -> throw new ApiRequestException(HttpStatus.CONFLICT, "Already friends");
				case PENDING -> throw new ApiRequestException(HttpStatus.CONFLICT, "Friend request already exists");
				case BLOCKED -> throw new ApiRequestException(HttpStatus.FORBIDDEN, "Friend request not allowed");
			}
		});

		FriendshipEntity entity = new FriendshipEntity();
		entity.setRequesterId(requesterId);
		entity.setAddresseeId(addresseeId);
		entity.setStatus(FriendshipStatus.PENDING);
		return friendshipRepository.save(entity);
	}

	@Transactional
	public FriendshipEntity accept(UUID currentUserId, UUID friendshipId) {
		FriendshipEntity entity = friendshipRepository.findById(friendshipId)
			.orElseThrow(() -> new ApiRequestException(HttpStatus.NOT_FOUND, "Friend request not found"));
		if (!entity.getAddresseeId().equals(currentUserId)) {
			throw new ApiRequestException(HttpStatus.FORBIDDEN, "Only the addressee can accept this request");
		}
		if (entity.getStatus() != FriendshipStatus.PENDING) {
			throw new ApiRequestException(HttpStatus.CONFLICT, "Friend request is not pending");
		}
		entity.setStatus(FriendshipStatus.ACCEPTED);
		return friendshipRepository.save(entity);
	}

	@Transactional
	public void decline(UUID currentUserId, UUID friendshipId) {
		FriendshipEntity entity = friendshipRepository.findById(friendshipId)
			.orElseThrow(() -> new ApiRequestException(HttpStatus.NOT_FOUND, "Friend request not found"));
		if (!entity.getAddresseeId().equals(currentUserId)) {
			throw new ApiRequestException(HttpStatus.FORBIDDEN, "Only the addressee can decline this request");
		}
		friendshipRepository.delete(entity);
	}

	@Transactional
	public void remove(UUID currentUserId, UUID otherUserId) {
		FriendshipEntity entity = friendshipRepository.findBetween(currentUserId, otherUserId)
			.orElseThrow(() -> new ApiRequestException(HttpStatus.NOT_FOUND, "Friendship not found"));
		friendshipRepository.delete(entity);
	}

	@Transactional(readOnly = true)
	public List<UserEntity> listFriends(UUID userId) {
		List<FriendshipEntity> accepted = friendshipRepository.findAllAcceptedForUser(userId);
		Set<UUID> friendIds = new HashSet<>();
		for (FriendshipEntity f : accepted) {
			friendIds.add(f.getRequesterId().equals(userId) ? f.getAddresseeId() : f.getRequesterId());
		}
		if (friendIds.isEmpty()) {
			return List.of();
		}
		return userRepository.findAllById(friendIds);
	}

	@Transactional(readOnly = true)
	public List<FriendshipEntity> listPendingIncoming(UUID userId) {
		return friendshipRepository.findAllForUserWithStatus(userId, FriendshipStatus.PENDING).stream()
			.filter(f -> f.getAddresseeId().equals(userId))
			.toList();
	}

	@Transactional(readOnly = true)
	public List<FriendshipEntity> listPendingOutgoing(UUID userId) {
		return friendshipRepository.findAllForUserWithStatus(userId, FriendshipStatus.PENDING).stream()
			.filter(f -> f.getRequesterId().equals(userId))
			.toList();
	}

	@Transactional(readOnly = true)
	public boolean areFriends(UUID userA, UUID userB) {
		return friendshipRepository.findBetween(userA, userB)
			.map(f -> f.getStatus() == FriendshipStatus.ACCEPTED)
			.orElse(false);
	}
}
