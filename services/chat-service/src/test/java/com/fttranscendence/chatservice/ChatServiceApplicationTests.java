package com.fttranscendence.chatservice;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.IndexInfo;

import com.fttranscendence.chatservice.support.MongoTestSupport;

/**
 * Boots the whole application against a real MongoDB. Catches missing beans,
 * unresolvable configuration placeholders and unparseable repository method
 * names — and, because the app really starts, it also proves that the startup
 * index creation runs.
 */
// A real servlet container, not the mock one: the WebSocket container bean
// (ServletServerContainerFactoryBean) needs a real jakarta.websocket
// ServerContainer, exactly as production does.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ChatServiceApplicationTests extends MongoTestSupport {

    @Autowired
    private MongoTemplate mongoTemplate;

    @Test
    void contextLoads() {
    }

    /** Kept as a literal: MongoIndexConfig's constant is package-private. */
    private static final String ROOM_HISTORY_INDEX = "room_id_1__id_-1";

    @Test
    @DisplayName("starting the application creates the room history index")
    void startupCreatesTheRoomHistoryIndex() {
        List<IndexInfo> indexes = mongoTemplate.indexOps("messages").getIndexInfo();

        assertThat(indexes)
                .extracting(IndexInfo::getName)
                .contains(ROOM_HISTORY_INDEX);
    }
}
