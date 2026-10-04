package com.fttranscendence.identity.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
	@NotBlank
	@Size(min = 3, max = 32)
	String username,

	@NotBlank
	@Email
	@Size(max = 255)
	String email,

	@NotBlank
	@Size(min = 8, max = 128)
	String password,

	@Size(max = 80)
	String displayName
) {
}
