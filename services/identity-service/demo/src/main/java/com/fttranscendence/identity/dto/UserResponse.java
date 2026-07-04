package com.fttranscendence.identity.dto;

import com.fttranscendence.identity.model.AuthProvider;
import com.fttranscendence.identity.model.UserEntity;
import java.time.Instant;
import java.util.UUID;

public record UserResponse(
	UUID id,
	String username,
	String email,
	String displayName,
	String bio,
	String avatarUrl,
	AuthProvider authProvider,
	Instant createdAt,
	Instant updatedAt
) {
	public static UserResponse from(UserEntity user) {
		return new UserResponse(
			user.getId(),
			user.getUsername(),
			user.getEmail(),
			user.getDisplayName(),
			user.getBio(),
			user.getAvatarUrl(),
			user.getAuthProvider(),
			user.getCreatedAt(),
			user.getUpdatedAt()
		);
	}
}
