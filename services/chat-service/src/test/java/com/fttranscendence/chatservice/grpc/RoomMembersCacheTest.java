package com.fttranscendence.chatservice.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.exception.ApiException;

/** When RoomMembersCache asks org, and when it doesn't. */
class RoomMembersCacheTest {

    private static final long ROOM = 1L;
    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";

    private OrgClient orgClient;
    private RoomMembersCache cache;

    @BeforeEach
    void setUp() {
        orgClient = mock(OrgClient.class);
        cache = new RoomMembersCache(orgClient);
    }

    @Test
    @DisplayName("many messages in one room cost one call to org")
    void loadsOnce() {
        when(orgClient.memberIds(ROOM, ALICE)).thenReturn(List.of(ALICE, BOB));

        assertThat(cache.members(ROOM, ALICE)).containsExactly(ALICE, BOB);
        assertThat(cache.members(ROOM, ALICE)).containsExactly(ALICE, BOB);
        assertThat(cache.members(ROOM, BOB)).containsExactly(ALICE, BOB);

        verify(orgClient, times(1)).memberIds(ROOM, ALICE);
    }

    @Test
    @DisplayName("after invalidate, the next lookup asks org again and sees the new members")
    void invalidateReloads() {
        when(orgClient.memberIds(ROOM, ALICE))
                .thenReturn(List.of(ALICE, BOB))
                .thenReturn(List.of(ALICE));

        cache.members(ROOM, ALICE);
        cache.invalidate(ROOM);

        assertThat(cache.isCached(ROOM)).isFalse();
        assertThat(cache.members(ROOM, ALICE)).containsExactly(ALICE);
        verify(orgClient, times(2)).memberIds(ROOM, ALICE);
    }

    @Test
    @DisplayName("a failed load is not cached, so the next message retries")
    void failureIsNotCached() {
        when(orgClient.memberIds(ROOM, ALICE))
                .thenThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ORG_UNAVAILABLE", "down"))
                .thenReturn(List.of(ALICE));

        assertThatThrownBy(() -> cache.members(ROOM, ALICE)).isInstanceOf(ApiException.class);
        assertThat(cache.isCached(ROOM)).isFalse();
        assertThat(cache.members(ROOM, ALICE)).containsExactly(ALICE);
    }

    @Test
    @DisplayName("invalidating a room that was never loaded is a no-op")
    void invalidateUnknownRoom() {
        cache.invalidate(99L);

        assertThat(cache.isCached(99L)).isFalse();
    }
}
