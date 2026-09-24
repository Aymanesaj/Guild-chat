package com.fttranscendence.chatservice.grpc;


/**
 * What org says about a user in a room. role is "" when org sends none
 * (an older org-service, or not a member).
 */
public record Membership(boolean member, String role) {

    public static final Membership NONE = new Membership(false, "");

    /** OWNER and ADMIN may delete other members' messages. Any other or unknown role may not. */
    public boolean canModerate() {
        return member && ("OWNER".equals(role) || "ADMIN".equals(role));
    }
}
