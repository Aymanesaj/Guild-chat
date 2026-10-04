package com.fttranscendence.identity.dto;

import jakarta.validation.constraints.Size;

public record UpdateProfileRequest(
	@Size(min = 3, max = 32)
	String username,

	@Size(max = 80)
	String displayName,

	@Size(max = 280)
	String bio
) {
}
