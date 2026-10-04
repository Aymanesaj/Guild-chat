package com.fttranscendence.identity.service;

import com.fttranscendence.identity.exception.ApiRequestException;
import com.fttranscendence.identity.model.RefreshTokenEntity;
import com.fttranscendence.identity.model.UserEntity;
import com.fttranscendence.identity.repository.RefreshTokenRepository;
import com.fttranscendence.identity.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RefreshTokenService {
	private static final SecureRandom RANDOM = new SecureRandom();

	private final RefreshTokenRepository refreshTokenRepository;
	private final UserRepository userRepository;
	private final long ttlSeconds;

	public RefreshTokenService(
		RefreshTokenRepository refreshTokenRepository,
		UserRepository userRepository,
		@Value("${app.jwt.refresh-ttl-seconds}") long ttlSeconds
	) {
		this.refreshTokenRepository = refreshTokenRepository;
		this.userRepository = userRepository;
		this.ttlSeconds = ttlSeconds;
	}

	@Transactional
	public String issue(UserEntity user) {
		String rawToken = generateOpaqueToken();
		RefreshTokenEntity entity = new RefreshTokenEntity();
		entity.setUserId(user.getId());
		entity.setTokenHash(sha256(rawToken));
		entity.setExpiresAt(Instant.now().plusSeconds(ttlSeconds));
		refreshTokenRepository.save(entity);
		return rawToken;
	}

	@Transactional
	public RefreshResult rotate(String presentedToken) {
		if (presentedToken == null || presentedToken.isBlank()) {
			throw new ApiRequestException(HttpStatus.UNAUTHORIZED, "Refresh token is required");
		}
		String hash = sha256(presentedToken);
		RefreshTokenEntity existing = refreshTokenRepository.findByTokenHash(hash)
			.orElseThrow(() -> new ApiRequestException(HttpStatus.UNAUTHORIZED, "Invalid refresh token"));

		if (existing.isRevoked()) {
			// Reuse of a rotated/revoked token: revoke all sessions for that user.
			refreshTokenRepository.revokeAllForUser(existing.getUserId());
			throw new ApiRequestException(HttpStatus.UNAUTHORIZED, "Refresh token reuse detected; sessions revoked");
		}
		if (Instant.now().isAfter(existing.getExpiresAt())) {
			existing.setRevoked(true);
			refreshTokenRepository.save(existing);
			throw new ApiRequestException(HttpStatus.UNAUTHORIZED, "Refresh token expired");
		}

		UserEntity user = userRepository.findById(existing.getUserId())
			.orElseThrow(() -> new ApiRequestException(HttpStatus.UNAUTHORIZED, "User no longer exists"));

		// Revoke the old token.
		existing.setRevoked(true);
		refreshTokenRepository.save(existing);

		// Issue a new one and link them.
		String newRaw = generateOpaqueToken();
		RefreshTokenEntity replacement = new RefreshTokenEntity();
		replacement.setUserId(user.getId());
		replacement.setTokenHash(sha256(newRaw));
		replacement.setExpiresAt(Instant.now().plusSeconds(ttlSeconds));
		RefreshTokenEntity saved = refreshTokenRepository.save(replacement);

		existing.setReplacedBy(saved.getId());
		refreshTokenRepository.save(existing);

		return new RefreshResult(user, newRaw);
	}

	@Transactional
	public void revokeAll(UUID userId) {
		refreshTokenRepository.revokeAllForUser(userId);
	}

	private String generateOpaqueToken() {
		byte[] bytes = new byte[32];
		RANDOM.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	private String sha256(String value) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
			StringBuilder sb = new StringBuilder(hash.length * 2);
			for (byte b : hash) {
				sb.append(String.format("%02x", b));
			}
			return sb.toString();
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException("SHA-256 not available", e);
		}
	}

	public record RefreshResult(UserEntity user, String newRefreshToken) {
	}
}
