package com.fttranscendence.identity.dto;

public record AuthResponse(String tokenType, String accessToken, String refreshToken, UserResponse user) {

	public static AuthResponse bearer(String accessToken, String refreshToken, UserResponse user) {
		return new AuthResponse("Bearer", accessToken, refreshToken, user);
	}
}
