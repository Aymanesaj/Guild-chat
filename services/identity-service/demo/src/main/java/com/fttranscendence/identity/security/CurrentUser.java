package com.fttranscendence.identity.security;

import com.fttranscendence.identity.exception.ApiRequestException;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

public final class CurrentUser {
	private CurrentUser() {
	}

	public static UUID id() {
		Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
		if (authentication == null || !(authentication.getPrincipal() instanceof UUID userId)) {
			throw new ApiRequestException(HttpStatus.UNAUTHORIZED, "Authentication required");
		}
		return userId;
	}
}
