package com.ft_transcendence.orgservice.dto;

import com.ft_transcendence.orgservice.model.RoleName;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record UpdateMemberRoleRequest(
                @NotNull
                @Size(max = 100)
                RoleName roleName
) {
}