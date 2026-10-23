package com.fttranscendence.chatservice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.dto.AttachmentResponse;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.MediaClient;
import com.fttranscendence.chatservice.model.Attachment;

/** Signing, caching and the pause after media fails; a hand-moved clock, no sleeping. */
class AttachmentUrlsTest {

    private static final String OWNER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final Instant T0 = Instant.parse("2026-10-23T10:00:00Z");
    private static final Attachment IMAGE = new Attachment("m1", OWNER, "image/webp", 1600, 1200);
    private static final Attachment OTHER = new Attachment("m2", OWNER, "image/webp", 800, 600);

    /** A clock the test moves forward by hand. */
    private static final class MovableClock extends Clock {
        private Instant now = T0;

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }

    private MediaClient media;
    private MovableClock clock;
    private AttachmentUrls urls;

    @BeforeEach
    void setUp() {
        media = mock(MediaClient.class);
        clock = new MovableClock();
        urls = new AttachmentUrls(media, clock);
        when(media.downloadUrl("m1", OWNER)).thenReturn(new MediaClient.SignedUrl("https://r2/m1?sig=1", 300));
        when(media.downloadUrl("m2", OWNER)).thenReturn(new MediaClient.SignedUrl("https://r2/m2?sig=1", 300));
    }

    private static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE", "Image service is unavailable");
    }

    @Test
    @DisplayName("signs with the stored owner and keeps the image's size and type")
    void signsImage() {
        AttachmentResponse response = urls.sign(IMAGE);

        assertThat(response).isEqualTo(new AttachmentResponse(
                "m1", "image/webp", 1600, 1200, "https://r2/m1?sig=1", T0.plusSeconds(300)));
        verify(media).downloadUrl("m1", OWNER);
    }

    @Test
    @DisplayName("a URL with more than a minute left is reused: one history load, one media call per image")
    void reusesValidUrl() {
        urls.sign(IMAGE);
        clock.advance(Duration.ofSeconds(239)); // 61 s left

        assertThat(urls.sign(IMAGE).url()).isEqualTo("https://r2/m1?sig=1");
        verify(media, times(1)).downloadUrl("m1", OWNER);
    }

    @Test
    @DisplayName("a URL with a minute or less left is re-signed, so a client always has time to load it")
    void resignsNearExpiry() {
        urls.sign(IMAGE);
        clock.advance(Duration.ofSeconds(240)); // exactly 60 s left
        when(media.downloadUrl("m1", OWNER)).thenReturn(new MediaClient.SignedUrl("https://r2/m1?sig=2", 300));

        AttachmentResponse response = urls.sign(IMAGE);

        assertThat(response.url()).isEqualTo("https://r2/m1?sig=2");
        assertThat(response.urlExpiresAt()).isEqualTo(T0.plusSeconds(540));
    }

    @Test
    @DisplayName("an image media cannot find comes back without a URL; other images are still signed")
    void missingImageHasNoUrl() {
        when(media.downloadUrl("m1", OWNER)).thenThrow(ApiException.notFound("ATTACHMENT_NOT_FOUND", "Image not found"));

        AttachmentResponse missing = urls.sign(IMAGE);

        assertThat(missing.url()).isNull();
        assertThat(missing.urlExpiresAt()).isNull();
        assertThat(missing.mediaId()).isEqualTo("m1");
        assertThat(urls.sign(OTHER).url()).as("a 404 does not pause signing").isEqualTo("https://r2/m2?sig=1");
    }

    @Test
    @DisplayName("media down: no URL, and media is not asked again for 5 s (a page has many images)")
    void pausesAfterUnavailable() {
        when(media.downloadUrl("m1", OWNER)).thenThrow(unavailable());

        assertThat(urls.sign(IMAGE).url()).isNull();
        assertThat(urls.sign(OTHER).url()).isNull();
        verify(media, never()).downloadUrl("m2", OWNER);

        clock.advance(Duration.ofSeconds(5));
        assertThat(urls.sign(OTHER).url()).as("asks again after the pause").isEqualTo("https://r2/m2?sig=1");
    }

    @Test
    @DisplayName("during the pause, already cached URLs are still served")
    void pauseStillServesCache() {
        urls.sign(OTHER);
        when(media.downloadUrl("m1", OWNER)).thenThrow(unavailable());
        urls.sign(IMAGE);

        assertThat(urls.sign(OTHER).url()).isEqualTo("https://r2/m2?sig=1");
    }

    @Test
    @DisplayName("forget drops the cached URL: a deleted image is never served from memory")
    void forgetDropsUrl() {
        urls.sign(IMAGE);
        urls.forget("m1");
        urls.sign(IMAGE);

        verify(media, times(2)).downloadUrl("m1", OWNER);
    }

    @Test
    @DisplayName("the cache is bounded: when full, expired URLs are dropped first")
    void cacheIsBounded() {
        when(media.downloadUrl(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq(OWNER)))
                .thenAnswer(i -> new MediaClient.SignedUrl("https://r2/" + i.getArgument(0), 300));
        for (int i = 0; i < AttachmentUrls.MAX_ENTRIES; i++) {
            urls.sign(new Attachment("old" + i, OWNER, "image/webp", 1, 1));
        }
        clock.advance(Duration.ofSeconds(250));

        urls.sign(new Attachment("new", OWNER, "image/webp", 1, 1));
        urls.sign(new Attachment("new", OWNER, "image/webp", 1, 1));

        verify(media, times(1)).downloadUrl("new", OWNER);
        urls.sign(new Attachment("old0", OWNER, "image/webp", 1, 1));
        verify(media, times(2)).downloadUrl("old0", OWNER);
    }
}
