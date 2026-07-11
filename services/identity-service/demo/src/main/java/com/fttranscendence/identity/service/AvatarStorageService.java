package com.fttranscendence.identity.service;

import com.fttranscendence.identity.exception.ApiRequestException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class AvatarStorageService {
	private static final Map<String, String> EXTENSIONS_BY_MEDIA_TYPE = Map.of(
		MediaType.IMAGE_JPEG_VALUE, ".jpg",
		MediaType.IMAGE_PNG_VALUE, ".png",
		"image/webp", ".webp",
		"image/gif", ".gif"
	);

	private final Path storageDir;

	public AvatarStorageService(@Value("${app.avatar.storage-dir}") String storageDir) {
		this.storageDir = Path.of(storageDir);
	}

	public String store(UUID userId, MultipartFile file) {
		if (file == null || file.isEmpty()) {
			throw new ApiRequestException(HttpStatus.BAD_REQUEST, "Avatar file is required");
		}
		String contentType = file.getContentType();
		String extension = EXTENSIONS_BY_MEDIA_TYPE.get(contentType);
		if (extension == null) {
			throw new ApiRequestException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Avatar must be jpg, png, webp, or gif");
		}
		try {
			Files.createDirectories(storageDir);
			String filename = userId + extension;
			Path target = storageDir.resolve(filename).normalize();
			file.transferTo(target);
			return "/api/users/avatars/" + filename;
		} catch (IOException exception) {
			throw new ApiRequestException(HttpStatus.INTERNAL_SERVER_ERROR, "Unable to store avatar");
		}
	}

	public ResponseEntity<Resource> load(String filename) {
		try {
			Path file = storageDir.resolve(filename).normalize();
			if (!file.startsWith(storageDir.normalize()) || !Files.exists(file)) {
				throw new ApiRequestException(HttpStatus.NOT_FOUND, "Avatar not found");
			}
			Resource resource = new UrlResource(file.toUri());
			String contentType = Files.probeContentType(file);
			return ResponseEntity.ok()
				.cacheControl(CacheControl.noCache())
				.header(HttpHeaders.CONTENT_TYPE, contentType == null ? MediaType.APPLICATION_OCTET_STREAM_VALUE : contentType)
				.body(resource);
		} catch (IOException exception) {
			throw new ApiRequestException(HttpStatus.NOT_FOUND, "Avatar not found");
		}
	}
}
