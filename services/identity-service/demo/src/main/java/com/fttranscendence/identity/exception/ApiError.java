package com.fttranscendence.identity.exception;

import java.time.Instant;

public record ApiError(int status, String message, Instant timestamp) {
}
