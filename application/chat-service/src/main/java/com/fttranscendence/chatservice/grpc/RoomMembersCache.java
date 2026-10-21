package com.fttranscendence.chatservice.grpc;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * Who is in a room, remembered between messages.
 *
 * room.activity goes to every member of a room, so each message needs the
 * member list. Asking org every time would add a gRPC round trip per message;
 * membership changes far less often than messages are sent.
 *
 * In memory only, never in the database: org stays the source of truth (see
 * OrgClient). An entry is dropped whenever org reports that the room changed
 * (RoomChangedConsumer), so the next message reloads it.
 *
 * What staleness costs: if org's notification is lost (chat restarting, a
 * dropped call), a kicked user keeps receiving the room's previews until the
 * next change to that room or a chat restart. Previews only, never history:
 * subscribe, REST reads and sends all ask org directly every time.
 */
@Component
public class RoomMembersCache {

    private final OrgClient orgClient;
    private final Map<Long, List<String>> membersByRoom = new ConcurrentHashMap<>();

    public RoomMembersCache(OrgClient orgClient) {
        this.orgClient = orgClient;
    }

    /**
     * The room's member ids, loaded from org on first use.
     *
     * @param askingUserId a current member of the room (org answers only
     *        members); used only when the list has to be loaded
     * @throws com.fttranscendence.chatservice.exception.ApiException when it
     *         is not cached and org cannot be reached; nothing is cached then
     */
    public List<String> members(Long roomId, String askingUserId) {
        // computeIfAbsent would hold the map's bin lock across a network call;
        // a rare duplicate load when two messages race is cheaper than that.
        List<String> cached = membersByRoom.get(roomId);
        if (cached != null) {
            return cached;
        }
        List<String> loaded = orgClient.memberIds(roomId, askingUserId);
        membersByRoom.put(roomId, loaded);
        return loaded;
    }

    /** Forgets a room, so its next lookup asks org again. Unknown rooms are a no-op. */
    public void invalidate(Long roomId) {
        membersByRoom.remove(roomId);
    }

    // ---- for tests ----

    boolean isCached(Long roomId) {
        return membersByRoom.containsKey(roomId);
    }
}
