package com.fttranscendence.identity.service;

import com.fttranscendence.identity.dto.AuthResponse;
import com.fttranscendence.identity.dto.LoginRequest;
import com.fttranscendence.identity.dto.RegisterRequest;
import com.fttranscendence.identity.dto.UserResponse;
import com.fttranscendence.identity.exception.ApiRequestException;
import com.fttranscendence.identity.model.AuthProvider;
import com.fttranscendence.identity.model.UserEntity;
import com.fttranscendence.identity.repository.UserRepository;
import com.fttranscendence.identity.security.JwtService;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
	private final UserRepository userRepository;
	private final PasswordEncoder passwordEncoder;
	private final JwtService jwtService;

	public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtService jwtService) {
		this.userRepository = userRepository;
		this.passwordEncoder = passwordEncoder;
		this.jwtService = jwtService;
	}

	@Transactional
	public AuthResponse register(RegisterRequest request) {
		String username = normalizeUsername(request.username());
		String email = normalizeEmail(request.email());
		if (userRepository.existsByUsernameIgnoreCase(username)) {
			throw new ApiRequestException(HttpStatus.CONFLICT, "Username is already taken");
		}
		if (userRepository.existsByEmailIgnoreCase(email)) {
			throw new ApiRequestException(HttpStatus.CONFLICT, "Email is already registered");
		}

		UserEntity user = new UserEntity();
		user.setUsername(username);
		user.setEmail(email);
		user.setPasswordHash(passwordEncoder.encode(request.password()));
		user.setDisplayName(blankToDefault(request.displayName(), username));
		user.setAuthProvider(AuthProvider.LOCAL);

		UserEntity saved = userRepository.save(user);
		return AuthResponse.bearer(jwtService.issue(saved), UserResponse.from(saved));
	}

	@Transactional(readOnly = true)
	public AuthResponse login(LoginRequest request) {
		String identifier = request.identifier().trim();
		UserEntity user = userRepository.findByEmailIgnoreCase(identifier)
			.or(() -> userRepository.findByUsernameIgnoreCase(identifier))
			.orElseThrow(() -> new BadCredentialsException("Invalid credentials"));

		if (user.getPasswordHash() == null || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
			throw new BadCredentialsException("Invalid credentials");
		}
		return AuthResponse.bearer(jwtService.issue(user), UserResponse.from(user));
	}

	private String normalizeUsername(String username) {
		return username.trim().toLowerCase();
	}

	private String normalizeEmail(String email) {
		return email.trim().toLowerCase();
	}

	private String blankToDefault(String value, String fallback) {
		return value == null || value.isBlank() ? fallback : value.trim();
	}
}
