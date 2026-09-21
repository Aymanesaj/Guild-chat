
package com.fttranscendence.chatservice.exception;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * Every error leaves this service in the spec's envelope:
 *   { "error": { "code": "...", "message": "..." } }
 *
 * Applies to REST only — a WebSocket frame never passes through Spring MVC,
 * so the handler there writes an error frame instead.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> handleApiException(ApiException e) {
        return ResponseEntity.status(e.getStatus()).body(body(e.getCode(), e.getMessage()));
    }

    /** e.g. /rooms/abc/messages — "abc" is not a Long. */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, Object>> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.badRequest()
                .body(body("INVALID_PARAMETER", "'" + e.getName() + "' has an invalid value"));
    }

    /** Anything unplanned: log the detail, tell the client nothing useful to an attacker. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleUnexpected(Exception e) {
        log.error("Unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(body("INTERNAL_ERROR", "Unexpected error"));
    }

    private Map<String, Object> body(String code, String message) {
        return Map.of("error", Map.of("code", code, "message", message));
    }
}
