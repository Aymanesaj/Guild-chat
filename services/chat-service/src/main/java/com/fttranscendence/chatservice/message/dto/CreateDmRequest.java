package com.fttranscendence.chatservice.message.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class CreateDmRequest {

    @NotBlank
    private String targetUserId;
}
