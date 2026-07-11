package com.fttranscendence.identity.service;

import com.fttranscendence.identity.dto.UpdateProfileRequest;
import com.fttranscendence.identity.dto.UserResponse;
import com.fttranscendence.identity.exception.ApiRequestException;
import com.fttranscendence.identity.model.UserEntity;
import com.fttranscendence.identity.repository.UserRepository;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {
	private final UserRepository userRepository;

	public UserService(UserRepository userRepository) {
		this.userRepository = userRepository;
	}

	@Transactional(readOnly = true)
	public UserResponse getUser(UUID id) {
		return UserResponse.from(findUser(id));
	}

	@Transactional
	public UserResponse updateProfile(UUID id, UpdateProfileRequest request) {
		UserEntity user = findUser(id);
		if (request.username() != null && !request.username().isBlank()) {
			String username = request.username().trim().toLowerCase();
			if (!username.equalsIgnoreCase(user.getUsername()) && userRepository.existsByUsernameIgnoreCase(username)) {
				throw new ApiRequestException(HttpStatus.CONFLICT, "Username is already taken");
			}
			user.setUsername(username);
		}
		if (request.displayName() != null) {
			user.setDisplayName(request.displayName().isBlank() ? user.getUsername() : request.displayName().trim());
		}
		if (request.bio() != null) {
			user.setBio(request.bio().trim());
		}
		return UserResponse.from(userRepository.save(user));
	}

	@Transactional
	public UserResponse updateAvatar(UUID id, String avatarUrl) {
		UserEntity user = findUser(id);
		user.setAvatarUrl(avatarUrl);
		return UserResponse.from(userRepository.save(user));
	}

	private UserEntity findUser(UUID id) {
		return userRepository.findById(id)
			.orElseThrow(() -> new ApiRequestException(HttpStatus.NOT_FOUND, "User not found"));
	}
}
