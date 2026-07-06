package com.fttranscendence.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.identity.dto.AuthResponse;
import com.fttranscendence.identity.dto.LoginRequest;
import com.fttranscendence.identity.dto.RegisterRequest;
import com.fttranscendence.identity.exception.ApiRequestException;
import com.fttranscendence.identity.model.AuthProvider;
import com.fttranscendence.identity.model.UserEntity;
import com.fttranscendence.identity.repository.UserRepository;
import com.fttranscendence.identity.security.JwtService;
import com.fttranscendence.identity.service.AuthService;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTests {
	private AuthService authService;
	private UserRepository userRepository;
	private PasswordEncoder passwordEncoder;

	@BeforeEach
	void setUp() {
		userRepository = fakeRepository();
		passwordEncoder = new BCryptPasswordEncoder();
		authService = new AuthService(
			userRepository,
			passwordEncoder,
			new JwtService(new ObjectMapper(), "test-secret-with-more-than-thirty-two-characters", "identity-service-test", 3600)
		);
	}

	@Test
	void registerHashesPasswordAndReturnsBearerToken() {
		AuthResponse response = authService.register(new RegisterRequest("Mehdi", "mehdi@example.com", "password123", "Mehdi"));

		assertThat(response.tokenType()).isEqualTo("Bearer");
		assertThat(response.accessToken()).isNotBlank();
		assertThat(response.user().username()).isEqualTo("mehdi");
		assertThat(userRepository.findByEmailIgnoreCase("mehdi@example.com"))
			.hasValueSatisfying(user -> assertThat(passwordEncoder.matches("password123", user.getPasswordHash())).isTrue());
	}

	@Test
	void duplicateEmailIsRejected() {
		authService.register(new RegisterRequest("first", "duplicate@example.com", "password123", null));

		assertThatThrownBy(() -> authService.register(new RegisterRequest("second", "duplicate@example.com", "password123", null)))
			.isInstanceOf(ApiRequestException.class)
			.hasMessageContaining("Email is already registered");
	}

	@Test
	void loginRejectsBadPassword() {
		authService.register(new RegisterRequest("loginuser", "login@example.com", "password123", null));

		assertThatThrownBy(() -> authService.login(new LoginRequest("login@example.com", "wrong-password")))
			.isInstanceOf(BadCredentialsException.class);
	}

	private UserRepository fakeRepository() {
		Map<String, UserEntity> byEmail = new HashMap<>();
		Map<String, UserEntity> byUsername = new HashMap<>();
		InvocationHandler handler = (proxy, method, args) -> switch (method.getName()) {
			case "existsByUsernameIgnoreCase" -> byUsername.containsKey(normalize((String) args[0]));
			case "existsByEmailIgnoreCase" -> byEmail.containsKey(normalize((String) args[0]));
			case "findByEmailIgnoreCase" -> Optional.ofNullable(byEmail.get(normalize((String) args[0])));
			case "findByUsernameIgnoreCase" -> Optional.ofNullable(byUsername.get(normalize((String) args[0])));
			case "findByAuthProviderAndOauthProviderId" -> Optional.empty();
			case "save" -> save((UserEntity) args[0], byEmail, byUsername);
			default -> throw new UnsupportedOperationException("Unexpected repository method in test: " + method.getName());
		};
		return (UserRepository) Proxy.newProxyInstance(
			UserRepository.class.getClassLoader(),
			new Class<?>[] {UserRepository.class},
			handler
		);
	}

	private UserEntity save(UserEntity user, Map<String, UserEntity> byEmail, Map<String, UserEntity> byUsername) throws Exception {
		if (user.getId() == null) {
			Field id = UserEntity.class.getDeclaredField("id");
			id.setAccessible(true);
			id.set(user, UUID.randomUUID());
		}
		if (user.getAuthProvider() == null) {
			user.setAuthProvider(AuthProvider.LOCAL);
		}
		byEmail.put(normalize(user.getEmail()), user);
		byUsername.put(normalize(user.getUsername()), user);
		return user;
	}

	private String normalize(String value) {
		return value.toLowerCase();
	}
}
