package com.fttranscendence.chatservice.service;

/** Published once a user's read mark is stored, so their other sockets can clear the badge. */
public record RoomReadEvent(String userId, ReadStateService.ReadMark read) {
}
