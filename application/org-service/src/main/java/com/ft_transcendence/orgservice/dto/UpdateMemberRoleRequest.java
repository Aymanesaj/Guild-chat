package com.ft_transcendence.orgservice.dto;

import com.ft_transcendence.orgservice.model.RoleName;

import jakarta.validation.constraints.NotNull;

public record UpdateMemberRoleRequest(
                @NotNull
                RoleName roleName
) {
}