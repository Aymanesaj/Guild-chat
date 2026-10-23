
package com.fttranscendence.chatservice.service;

import org.springframework.stereotype.Service;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.MediaClient;
import com.fttranscendence.chatservice.grpc.OrgClient;

/**
 * Chat images. Media only knows owners, so room access is checked here,
 * before media-service is ever called.
 */
@Service
public class AttachmentService {

    private final MediaClient mediaClient;
    private final OrgClient orgClient;

    public AttachmentService(MediaClient mediaClient, OrgClient orgClient) {
        this.mediaClient = mediaClient;
        this.orgClient = orgClient;
    }

    /** A slot to upload one image; the caller becomes its owner. */
    public MediaClient.UploadTicket uploadUrl(String userId, Long roomId, String contentType) {
        if (!orgClient.isMember(userId, roomId)) {
            throw ApiException.forbidden("NOT_A_MEMBER", "User is not a member of the room");
        }
        return mediaClient.createUpload(userId, contentType);
    }
}
