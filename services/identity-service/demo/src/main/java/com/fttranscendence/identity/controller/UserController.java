package com.fttranscendence.identity.controller;

import com.fttranscendence.identity.dto.UpdateProfileRequest;
import com.fttranscendence.identity.dto.UserResponse;
import com.fttranscendence.identity.security.CurrentUser;
import com.fttranscendence.identity.service.AvatarStorageService;
import com.fttranscendence.identity.service.UserService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class UserController {
	private final UserService userService;
	private final AvatarStorageService avatarStorageService;

	public UserController(UserService userService, AvatarStorageService avatarStorageService) {
		this.userService = userService;
		this.avatarStorageService = avatarStorageService;
	}

	@GetMapping("/me")
	public UserResponse me() {
		return userService.getUser(CurrentUser.id());
	}

	@PutMapping("/me")
	public UserResponse updateMe(@Valid @RequestBody UpdateProfileRequest request) {
		return userService.updateProfile(CurrentUser.id(), request);
	}

	@PostMapping(value = "/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	public UserResponse uploadAvatar(@RequestPart("file") MultipartFile file) {
		String avatarUrl = avatarStorageService.store(CurrentUser.id(), file);
		return userService.updateAvatar(CurrentUser.id(), avatarUrl);
	}

	@GetMapping("/{id}")
	public UserResponse getUser(@PathVariable UUID id) {
		return userService.getUser(id);
	}
	
	@Transactional(readOnly = true)
	@GetMapping("/username/get")
	public UserResponse getUserByUsername(@RequestParam String username){
		return userService.getUserByUsername(username);
	}

	@GetMapping("/username/available")
    public Map<String, Object> usernameAvailable(@RequestParam String username) {
        boolean available = userService.isUsernameAvailable(username);
        return Map.of(
            "available", available,
            "message", available ? "Username is available" : "Username is taken"
        );
    }

	@GetMapping("/avatars/{filename:.+}")
	public ResponseEntity<Resource> avatar(@PathVariable String filename) {
		return avatarStorageService.load(filename);
	}
}
