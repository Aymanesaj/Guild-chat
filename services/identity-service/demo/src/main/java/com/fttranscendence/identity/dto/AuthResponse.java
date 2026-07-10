package com.fttranscendence.identity.dto;

public record AuthResponse(String tokenType, String accessToken, UserResponse user) {

	public static AuthResponse bearer(String token, UserResponse user) {
		return new AuthResponse("Bearer", token, user);
	}
}
