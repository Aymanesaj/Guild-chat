package com.fttranscendence.chatservice.dto;

import com.fttranscendence.chatservice.service.ReadStateService;

/** A read mark as the API shows it, over REST and in room.read frames. */
public record ReadMarkResponse(Long roomId, String lastReadId, int unread) {

    public static ReadMarkResponse from(ReadStateService.ReadMark read) {
        return new ReadMarkResponse(read.roomId(), read.lastReadId(), read.unread());
    }
}
