package com.fttranscendence.identity.exception;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

	@ExceptionHandler(ApiRequestException.class)
	public ResponseEntity<ApiError> apiRequest(ApiRequestException exception) {
		return ResponseEntity.status(exception.status()).body(new ApiError(exception.status().value(), exception.getMessage(), Instant.now()));
	}

	@ExceptionHandler(BadCredentialsException.class)
	public ResponseEntity<ApiError> badCredentials() {
		return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ApiError(401, "Invalid credentials", Instant.now()));
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ResponseEntity<Map<String, Object>> validation(MethodArgumentNotValidException exception) {
		Map<String, String> fields = new HashMap<>();
		for (FieldError error : exception.getBindingResult().getFieldErrors()) {
			fields.put(error.getField(), error.getDefaultMessage());
		}
		Map<String, Object> body = new HashMap<>();
		body.put("status", 400);
		body.put("message", "Validation failed");
		body.put("fields", fields);
		body.put("timestamp", Instant.now());
		return ResponseEntity.badRequest().body(body);
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<ApiError> fallback(Exception exception) {
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
			.body(new ApiError(500, "Unexpected identity-service error", Instant.now()));
	}
}
