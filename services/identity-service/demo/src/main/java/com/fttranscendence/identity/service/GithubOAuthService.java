package com.fttranscendence.identity.service;

import com.fttranscendence.identity.dto.AuthResponse;
import com.fttranscendence.identity.dto.GithubOAuthUrlResponse;
import com.fttranscendence.identity.dto.UserResponse;
import com.fttranscendence.identity.exception.ApiRequestException;
import com.fttranscendence.identity.model.AuthProvider;
import com.fttranscendence.identity.model.UserEntity;
import com.fttranscendence.identity.repository.UserRepository;
import com.fttranscendence.identity.security.JwtService;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

@Service
public class GithubOAuthService {
	private final UserRepository userRepository;
	private final JwtService jwtService;
	private final RefreshTokenService refreshTokenService;
	private final RestClient restClient;
	private final String clientId;
	private final String clientSecret;
	private final String redirectUri;

	public GithubOAuthService(
		UserRepository userRepository,
		JwtService jwtService,
		RefreshTokenService refreshTokenService,
		@Value("${app.oauth.github.client-id}") String clientId,
		@Value("${app.oauth.github.client-secret}") String clientSecret,
		@Value("${app.oauth.github.redirect-uri}") String redirectUri
	) {
		this.userRepository = userRepository;
		this.jwtService = jwtService;
		this.refreshTokenService = refreshTokenService;
		this.restClient = RestClient.create();
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.redirectUri = redirectUri;
	}

	public GithubOAuthUrlResponse authorizationUrl() {
		requireConfigured();
		String url = "https://github.com/login/oauth/authorize"
			+ "?client_id=" + encode(clientId)
			+ "&redirect_uri=" + encode(redirectUri)
			+ "&scope=" + encode("read:user user:email");
		return new GithubOAuthUrlResponse(url);
	}

	@Transactional
	public AuthResponse loginWithCode(String code) {
		requireConfigured();
		String accessToken = exchangeCodeForAccessToken(code);
		GithubUser githubUser = fetchGithubUser(accessToken);
		UserEntity user = userRepository.findByAuthProviderAndOauthProviderId(AuthProvider.GITHUB, githubUser.id())
			.orElseGet(() -> createGithubUser(githubUser));
		user.setAvatarUrl(githubUser.avatarUrl());
		UserEntity saved = userRepository.save(user);
		return AuthResponse.bearer(
			jwtService.issue(saved),
			refreshTokenService.issue(saved),
			UserResponse.from(saved)
		);
	}

	private String exchangeCodeForAccessToken(String code) {
		MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
		body.add("client_id", clientId);
		body.add("client_secret", clientSecret);
		body.add("code", code);
		body.add("redirect_uri", redirectUri);
		Map<?, ?> response = restClient.post()
			.uri("https://github.com/login/oauth/access_token")
			.contentType(MediaType.APPLICATION_FORM_URLENCODED)
			.accept(MediaType.APPLICATION_JSON)
			.body(body)
			.retrieve()
			.body(Map.class);
		if (response == null || response.get("access_token") == null) {
			throw new ApiRequestException(HttpStatus.BAD_GATEWAY, "GitHub OAuth token exchange failed");
		}
		return response.get("access_token").toString();
	}

	private GithubUser fetchGithubUser(String accessToken) {
		Map<?, ?> response = restClient.get()
			.uri("https://api.github.com/user")
			.header("Authorization", "Bearer " + accessToken)
			.accept(MediaType.APPLICATION_JSON)
			.retrieve()
			.body(Map.class);
		if (response == null || response.get("id") == null || response.get("login") == null) {
			throw new ApiRequestException(HttpStatus.BAD_GATEWAY, "GitHub profile lookup failed");
		}
		String id = response.get("id").toString();
		String username = response.get("login").toString();
		String email = response.get("email") == null ? username + "@users.noreply.github.com" : response.get("email").toString();
		String avatarUrl = response.get("avatar_url") == null ? null : response.get("avatar_url").toString();
		return new GithubUser(id, username, email, avatarUrl);
	}

	private UserEntity createGithubUser(GithubUser githubUser) {
		UserEntity user = new UserEntity();
		user.setUsername(uniqueUsername(githubUser.username()));
		user.setEmail(uniqueEmail(githubUser.email(), githubUser.username()));
		user.setDisplayName(githubUser.username());
		user.setAuthProvider(AuthProvider.GITHUB);
		user.setOauthProviderId(githubUser.id());
		user.setAvatarUrl(githubUser.avatarUrl());
		return user;
	}

	private String uniqueUsername(String baseUsername) {
		String base = baseUsername.toLowerCase().replaceAll("[^a-z0-9_\\-]", "");
		if (base.length() < 3) {
			base = "github-user";
		}
		base = base.substring(0, Math.min(base.length(), 24));
		String candidate = base;
		int suffix = 1;
		while (userRepository.existsByUsernameIgnoreCase(candidate)) {
			candidate = base + "-" + suffix++;
		}
		return candidate;
	}

	private String uniqueEmail(String email, String username) {
		String candidate = email.toLowerCase();
		if (!userRepository.existsByEmailIgnoreCase(candidate)) {
			return candidate;
		}
		return username.toLowerCase() + "+" + System.currentTimeMillis() + "@users.noreply.github.com";
	}

	private void requireConfigured() {
		if (clientId.isBlank() || clientSecret.isBlank()) {
			throw new ApiRequestException(HttpStatus.SERVICE_UNAVAILABLE, "GitHub OAuth is not configured");
		}
	}

	private String encode(String value) {
		return URLEncoder.encode(value, StandardCharsets.UTF_8);
	}

	private record GithubUser(String id, String username, String email, String avatarUrl) {
	}
}
