package com.fttranscendence.chatservice.model;

import org.springframework.data.mongodb.core.mapping.Field;

public record SystemEvent(
    @Field("type") String type,
    @Field("actor_id") String actorId,
    @Field("target_id") String targetId,
    @Field("role") String role ,
    @Field("previous_role") String previousRole,
    @Field("name") String name ,
    @Field("previous_name") String previousName) {

}
