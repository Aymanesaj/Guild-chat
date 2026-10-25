package com.fttranscendence.chatservice.dto;

import java.util.List;

/** Body of PUT /notifications/read. Checked by the service, for clear error codes. */
public record MarkNotificationsReadRequest(List<String> ids) {
}
