package com.fttranscendence.chatservice.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.websocket.PresenceRegistry;

/**
 * GET /presence?ids=a,b,c → { "a": "online", "b": "offline", "c": "offline" }
 *
 * A snapshot for the status dots. The client asks for the users it is showing
 * (room members, DM peers) and refreshes it while they're on screen.
 * Any authenticated user may ask about anyone: online/offline is not secret
 * in this app. Reachable through the gateway at /api/chat/presence.
 */
@RestController
public class PresenceController {

    static final int MAX_IDS = 100;

    private final PresenceRegistry presenceRegistry;

    public PresenceController(PresenceRegistry presenceRegistry) {
        this.presenceRegistry = presenceRegistry;
    }

    @GetMapping("/presence")
    public Map<String, String> presence(@RequestParam(required = false) List<String> ids) {
        // Spring splits ?ids=a,b,c on commas; ?ids=a&ids=b works too.
        List<String> wanted = ids == null ? List.of() : ids.stream()
                .map(String::trim)
                .filter(id -> !id.isEmpty())
                .distinct()
                .toList();

        if (wanted.isEmpty()) {
            throw ApiException.badRequest("MISSING_IDS", "'ids' must list at least one user id");
        }
        if (wanted.size() > MAX_IDS) {
            throw ApiException.badRequest("TOO_MANY_IDS", "'ids' may list at most " + MAX_IDS + " user ids");
        }

        return presenceRegistry.statuses(wanted);
    }
}
