package com.fttranscendence.identity.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.identity.model.UserEntity;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
	private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
	};

	private final ObjectMapper objectMapper;
	private final byte[] secret;
	private final String issuer;
	private final long ttlSeconds;

	public JwtService(
		ObjectMapper objectMapper,
		@Value("${app.jwt.secret}") String secret,
		@Value("${app.jwt.issuer}") String issuer,
		@Value("${app.jwt.ttl-seconds}") long ttlSeconds
	) {
		this.objectMapper = objectMapper;
		this.secret = secret.getBytes(StandardCharsets.UTF_8);
		this.issuer = issuer;
		this.ttlSeconds = ttlSeconds;
	}

	public String issue(UserEntity user) {
		Instant now = Instant.now();
		Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("iss", issuer);
		payload.put("sub", user.getId().toString());
		payload.put("username", user.getUsername());
		payload.put("email", user.getEmail());
		payload.put("iat", now.getEpochSecond());
		payload.put("exp", now.plusSeconds(ttlSeconds).getEpochSecond());

		String unsignedToken = encodeJson(header) + "." + encodeJson(payload);
		return unsignedToken + "." + sign(unsignedToken);
	}

	public Optional<UUID> validate(String token) {
		try {
			String[] parts = token.split("\\.");
			if (parts.length != 3) {
				return Optional.empty();
			}
			String unsignedToken = parts[0] + "." + parts[1];
			if (!MessageDigest.isEqual(sign(unsignedToken).getBytes(StandardCharsets.UTF_8), parts[2].getBytes(StandardCharsets.UTF_8))) {
				return Optional.empty();
			}
			Map<String, Object> payload = objectMapper.readValue(base64Decode(parts[1]), MAP_TYPE);
			if (!issuer.equals(payload.get("iss"))) {
				return Optional.empty();
			}
			Number expiresAt = (Number) payload.get("exp");
			if (expiresAt == null || Instant.now().getEpochSecond() >= expiresAt.longValue()) {
				return Optional.empty();
			}
			return Optional.of(UUID.fromString((String) payload.get("sub")));
		} catch (Exception ignored) {
			return Optional.empty();
		}
	}

	private String encodeJson(Map<String, Object> value) {
		try {
			return base64Encode(objectMapper.writeValueAsBytes(value));
		} catch (Exception exception) {
			throw new IllegalStateException("Unable to encode JWT payload", exception);
		}
	}

	private String sign(String payload) {
		try {
			Mac mac = Mac.getInstance("HmacSHA256");
			mac.init(new SecretKeySpec(secret, "HmacSHA256"));
			return base64Encode(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
		} catch (Exception exception) {
			throw new IllegalStateException("Unable to sign JWT", exception);
		}
	}

	private String base64Encode(byte[] bytes) {
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	private byte[] base64Decode(String value) {
		return Base64.getUrlDecoder().decode(value);
	}
}
