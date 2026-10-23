package com.fttranscendence.chatservice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.MediaClient;
import com.fttranscendence.chatservice.grpc.OrgClient;

@ExtendWith(MockitoExtension.class)
class AttachmentServiceTest {

    private static final long ROOM = 42L;
    private static final String USER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    @Mock
    private MediaClient mediaClient;

    @Mock
    private OrgClient orgClient;

    @InjectMocks
    private AttachmentService attachmentService;

    @Test
    @DisplayName("a member gets an upload slot owned by themselves")
    void memberGetsTicketOwnedByCaller() {
        MediaClient.UploadTicket ticket =
                new MediaClient.UploadTicket("upload-1", "https://r2/put", "image/png", 300);
        when(orgClient.isMember(USER, ROOM)).thenReturn(true);
        when(mediaClient.createUpload(USER, "image/png")).thenReturn(ticket);

        assertThat(attachmentService.uploadUrl(USER, ROOM, "image/png")).isEqualTo(ticket);
        verify(mediaClient).createUpload(USER, "image/png");
    }

    @Test
    @DisplayName("a non-member gets 403 and media-service is never called")
    void nonMemberIsRejectedBeforeMedia() {
        when(orgClient.isMember(USER, ROOM)).thenReturn(false);

        assertThatThrownBy(() -> attachmentService.uploadUrl(USER, ROOM, "image/png"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(e.getCode()).isEqualTo("NOT_A_MEMBER");
                });
        verifyNoInteractions(mediaClient);
    }
}
