package com.fttranscendence.chatservice.config;

import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.CompoundIndexDefinition;

@Configuration
public class MongoIndexConfig {

    private static final Logger log =
            LoggerFactory.getLogger(MongoIndexConfig.class);

    static final String COLLECTION = "messages";
    static final String ROOM_HISTORY_INDEX = "room_id_1__id_-1";

    private final MongoTemplate mongoTemplate;

    public MongoIndexConfig(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    /**
     * Creates the indexes required by the chat service.
     *
     * ensureIndex is idempotent, so calling this on every application
     * startup is safe.
     */
    @EventListener(ApplicationReadyEvent.class)
    public void createIndexes() {
        try {
            String name = mongoTemplate
                    .indexOps(COLLECTION)
                    .ensureIndex(
                            new CompoundIndexDefinition(
                                    new Document()
                                            .append("room_id", 1)
                                            .append("_id", -1))
                                    .named(ROOM_HISTORY_INDEX));

            log.info("MongoDB index ready on {}: {}", COLLECTION, name);
        } catch (DataAccessException e) {
            log.error("Could not create MongoDB index {} on {} — history queries will scan "
                    + "the whole collection until it exists", ROOM_HISTORY_INDEX, COLLECTION, e);
        }
    }
}
