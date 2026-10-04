package com.fttranscendence.identity.dto;

import com.fttranscendence.identity.model.FriendshipEntity;
import com.fttranscendence.identity.model.FriendshipStatus;
import java.time.Instant;
import java.util.UUID;

public record FriendRequestResponse(
	UUID id,
	UUID requesterId,
	UUID addresseeId,
	FriendshipStatus status,
	Instant createdAt,
	Instant updatedAt
) {
	public static FriendRequestResponse from(FriendshipEntity entity) {
		return new FriendRequestResponse(
			entity.getId(),
			entity.getRequesterId(),
			entity.getAddresseeId(),
			entity.getStatus(),
			entity.getCreatedAt(),
			entity.getUpdatedAt()
		);
	}
}
