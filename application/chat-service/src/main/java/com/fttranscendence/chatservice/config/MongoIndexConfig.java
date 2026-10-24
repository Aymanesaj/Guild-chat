package com.fttranscendence.chatservice.config;

import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.CompoundIndexDefinition;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.index.PartialIndexFilter;
import org.springframework.data.mongodb.core.query.Criteria;

import com.fttranscendence.chatservice.model.ReadState;

@Configuration
public class MongoIndexConfig {

    private static final Logger log =
            LoggerFactory.getLogger(MongoIndexConfig.class);

    static final String COLLECTION = "messages";
    static final String ROOM_HISTORY_INDEX = "room_id_1__id_-1";

    static final String SYSTEM_EVENT_INDEX = "event_id_unique";

    static final String READ_STATE_INDEX = "user_id_1_room_id_1_unique";

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

          try {
            String name = mongoTemplate
                    .indexOps(COLLECTION)
                    .ensureIndex(new Index()
                            .on("event_id", Sort.Direction.ASC)
                            .unique()
                            .partial(PartialIndexFilter.of(Criteria.where("event_id").exists(true)))
                            .named(SYSTEM_EVENT_INDEX));

            log.info("MongoDB index ready on {}: {}", COLLECTION, name);
        } catch (DataAccessException e) {
            log.error("Could not create MongoDB index {} on {}: a redelivered room event may be "
                    + "stored twice until it exists", SYSTEM_EVENT_INDEX, COLLECTION, e);
        }

        // One read mark per user and room: lets the upsert find it, and two
        // first reads at once cannot create two marks.
        try {
            String name = mongoTemplate
                    .indexOps(ReadState.COLLECTION)
                    .ensureIndex(new Index()
                            .on("user_id", Sort.Direction.ASC)
                            .on("room_id", Sort.Direction.ASC)
                            .unique()
                            .named(READ_STATE_INDEX));

            log.info("MongoDB index ready on {}: {}", ReadState.COLLECTION, name);
        } catch (DataAccessException e) {
            log.error("Could not create MongoDB index {} on {}: a user could get two read marks "
                    + "for one room until it exists", READ_STATE_INDEX, ReadState.COLLECTION, e);
        }
    }
}
