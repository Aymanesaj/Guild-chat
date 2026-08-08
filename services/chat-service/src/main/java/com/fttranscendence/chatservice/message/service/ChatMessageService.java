package com.fttranscendence.chatservice.message.service;

import com.fttranscendence.chatservice.message.domain.ChatMessage;
import com.fttranscendence.chatservice.message.repository.ChatMessageRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ChatMessageService {

    private final ChatMessageRepository chatMessageRepository;

    public ChatMessage save(String roomId, String senderId, String content) {
        ChatMessage message = ChatMessage.builder()
                .roomId(roomId)
                .senderId(senderId)
                .content(content)
                .sentAt(Instant.now())
                .build();

        return chatMessageRepository.save(message);
    }

    public List<ChatMessage> getHistory(String roomId, int page, int size) {
        return chatMessageRepository.findByRoomIdOrderBySentAtDesc(
                roomId,
                PageRequest.of(page, size)
        );
    }
}