package com.ft_transcendence.orgservice.dto;

import com.ft_transcendence.orgservice.model.RoleName;
import java.util.UUID;

public record MemberResponse(
        UUID userId,
        RoleName role
){
}