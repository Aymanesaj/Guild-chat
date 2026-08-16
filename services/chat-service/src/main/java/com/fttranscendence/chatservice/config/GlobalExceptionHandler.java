package com.fttranscendence.chatservice.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * One place that turns exceptions into HTTP responses for every controller.
 *
 * <p>Without this, Spring Boot's default error page decides the shape, and that
 * shape is neither stable nor entirely safe: on an unhandled exception it will
 * happily include the exception class name and message, which tends to expose
 * internals ("MongoTimeoutException: connecting to mongodb://chatdb:27017").
 *
 * <p>@RestControllerAdvice registers these handlers globally. When a controller
 * method throws, Spring looks for an @ExceptionHandler whose parameter type
 * matches the exception, most specific first, and uses its return value as the
 * response — the controller itself needs no try/catch.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * Thrown deliberately by our own code, e.g. RoomService.getRoomOrThrow.
     * The status and reason were chosen by us, so both are safe to pass through.
     */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(ResponseStatusException e) {
        HttpStatus status = HttpStatus.valueOf(e.getStatusCode().value());
        return ResponseEntity.status(status).body(body(status, e.getReason()));
    }

    /** Raised when a @Valid @RequestBody fails its constraints. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException e) {
        String detail = e.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + ": " + error.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return ResponseEntity.badRequest().body(body(HttpStatus.BAD_REQUEST, detail));
    }

    /**
     * Anything we did not anticipate. Logged in full for us, reduced to a
     * generic sentence for the client.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleUnexpected(Exception e) {
        log.error("Unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(body(HttpStatus.INTERNAL_SERVER_ERROR, "Unexpected server error"));
    }

    private Map<String, Object> body(HttpStatus status, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status", status.value());
        body.put("error", status.getReasonPhrase());
        body.put("message", message == null ? status.getReasonPhrase() : message);
        return body;
    }
}
