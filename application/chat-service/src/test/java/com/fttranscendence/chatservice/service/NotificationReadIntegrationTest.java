package com.fttranscendence.chatservice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.data.mongo.DataMongoTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.util.ReflectionTestUtils;

import com.fttranscendence.chatservice.config.MongoIndexConfig;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.model.Notification;
import com.fttranscendence.chatservice.model.ReadState;
import com.fttranscendence.chatservice.model.SystemEvent;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.repository.NotificationStore;
import com.fttranscendence.chatservice.repository.ReadStateStore;
import com.fttranscendence.chatservice.support.MongoTestSupport;

@DataMongoTest
@RecordApplicationEvents
@Import({ NotificationStore.class, ReadStateStore.class, ReadStateService.class, NotificationService.class,
        MongoIndexConfig.class, NotificationReadIntegrationTest.Time.class })
class NotificationReadIntegrationTest extends MongoTestSupport {
    private static final String USER = "alice";
    private static final Instant NOW = Instant.parse("2026-10-25T10:00:00Z");

    @TestConfiguration
    static class Time {
        @Bean Clock clock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
    }

    @Autowired MongoTemplate mongo;
    @Autowired MongoIndexConfig indexes;
    @Autowired MessageRepository messages;
    @Autowired NotificationStore notifications;
    @Autowired ReadStateService reads;
    @Autowired NotificationService service;
    @Autowired ApplicationEvents events;
    @MockBean OrgClient org;

    @BeforeEach
    void clean() {
        mongo.remove(new Query(), Notification.class);
        mongo.remove(new Query(), Message.class);
        mongo.remove(new Query(), ReadState.class);
        indexes.createIndexes();
        when(org.isMember(USER, 42L)).thenReturn(true);
    }

    private Message systemMessage(int position) {
        Message message = Message.system(42L, "event-" + position,
                new SystemEvent("ROLE_CHANGED", "bob", USER, "ADMIN", null, null, null), NOW);
        ReflectionTestUtils.setField(message, "id", String.format("%024x", position));
        return messages.insert(message);
    }

    @Test
    void readingTheRoomPersistsActivityReadsAndBroadcastsOnlyTheCoveredNotificationIds() {
        Message first = systemMessage(1);
        Message second = systemMessage(2);
        service.onMessageCreated(new MessageCreatedEvent(first));
        service.onMessageCreated(new MessageCreatedEvent(second));
        Notification covered = notifications.page(USER, null, 20).stream()
                .filter(n -> n.sourceId().equals(first.getId())).findFirst().orElseThrow();

        reads.markRead(USER, 42L, first.getId());

        assertThat(notifications.page(USER, null, 20)).filteredOn(n -> n.id().equals(covered.id()))
                .allSatisfy(n -> assertThat(n.readAt()).isEqualTo(NOW));
        assertThat(notifications.unreadCount(USER)).isEqualTo(1);
        assertThat(events.stream(NotificationsReadEvent.class).map(NotificationsReadEvent::read))
                .containsExactly(new NotificationService.ReadResult(List.of(covered.id()), false, 1));
    }

    @Test
    void activityInsertedAfterTheRoomReadIsClearedAndBroadcast() {
        Message message = systemMessage(1);
        reads.markRead(USER, 42L, message.getId());

        service.onMessageCreated(new MessageCreatedEvent(message));

        Notification notification = notifications.page(USER, null, 20).getFirst();
        assertThat(notification.readAt()).isEqualTo(NOW);
        assertThat(notifications.unreadCount(USER)).isZero();
        assertThat(events.stream(NotificationsReadEvent.class).map(NotificationsReadEvent::read))
                .containsExactly(new NotificationService.ReadResult(List.of(notification.id()), false, 0));
    }
}
