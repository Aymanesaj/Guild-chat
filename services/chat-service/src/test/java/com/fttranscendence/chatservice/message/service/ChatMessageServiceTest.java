package com.fttranscendence.chatservice.message.service;

import com.fttranscendence.chatservice.message.domain.ChatMessage;
import com.fttranscendence.chatservice.message.repository.ChatMessageRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ChatMessageServiceTest {

    @Mock
    private ChatMessageRepository chatMessageRepository;

    private ChatMessageService chatMessageService;

    @org.junit.jupiter.api.BeforeEach
    void setUp() {
        chatMessageService = new ChatMessageService(chatMessageRepository);
    }

    @Test
    void save_buildsMessageWithSenderRoomAndContent_andPersistsIt() {
        when(chatMessageRepository.save(any(ChatMessage.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        ChatMessage result = chatMessageService.save("room-1", "user-1", "hello");

        ArgumentCaptor<ChatMessage> captor = ArgumentCaptor.forClass(ChatMessage.class);
        verify(chatMessageRepository).save(captor.capture());

        ChatMessage saved = captor.getValue();
        assertThat(saved.getRoomId()).isEqualTo("room-1");
        assertThat(saved.getSenderId()).isEqualTo("user-1");
        assertThat(saved.getContent()).isEqualTo("hello");
        assertThat(saved.getSentAt()).isNotNull();
        assertThat(result).isSameAs(saved);
    }

    @Test
    void getHistory_delegatesToRepositoryWithPagination() {
        ChatMessage msg = ChatMessage.builder().id("m1").roomId("room-1").build();
        when(chatMessageRepository.findByRoomIdOrderBySentAtDesc(eq("room-1"), any()))
                .thenReturn(List.of(msg));

        List<ChatMessage> history = chatMessageService.getHistory("room-1", 0, 20);

        assertThat(history).containsExactly(msg);
        verify(chatMessageRepository).findByRoomIdOrderBySentAtDesc(eq("room-1"), any());
    }
}
