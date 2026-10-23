
package com.fttranscendence.chatservice.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Body of POST /rooms/:id/attachments/upload-url.
 *
 * The type is checked here so the browser gets a clear error: media-service
 * only answers "Invalid request fields" for an unsupported type.
 */
public record UploadUrlRequest(
    @NotBlank(message = "content_type is required")
    @Pattern(regexp = "image/(jpeg|png|webp)", message = "Only JPEG, PNG and WebP images are supported")
    String contentType) {
}
