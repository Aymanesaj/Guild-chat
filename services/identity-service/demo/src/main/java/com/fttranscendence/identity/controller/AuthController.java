package com.fttranscendence.identity.controller;

import com.fttranscendence.identity.dto.AuthResponse;
import com.fttranscendence.identity.dto.GithubOAuthUrlResponse;
import com.fttranscendence.identity.dto.LoginRequest;
import com.fttranscendence.identity.dto.RegisterRequest;
import com.fttranscendence.identity.service.AuthService;
import com.fttranscendence.identity.service.GithubOAuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {
	private final AuthService authService;
	private final GithubOAuthService githubOAuthService;

	public AuthController(AuthService authService, GithubOAuthService githubOAuthService) {
		this.authService = authService;
		this.githubOAuthService = githubOAuthService;
	}

	@PostMapping("/register")
	public AuthResponse register(@Valid @RequestBody RegisterRequest request) {
		return authService.register(request);
	}

	@PostMapping("/login")
	public AuthResponse login(@Valid @RequestBody LoginRequest request) {
		return authService.login(request);
	}

	@GetMapping("/oauth/github/url")
	public GithubOAuthUrlResponse githubOAuthUrl() {
		return githubOAuthService.authorizationUrl();
	}

	@GetMapping("/oauth/github/callback")
	public AuthResponse githubOAuthCallback(@RequestParam String code) {
		return githubOAuthService.loginWithCode(code);
	}
}
