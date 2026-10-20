# Org → Chat room events

Org records an internal `RoomChangedEvent` inside the room mutation transaction.
`RoomEventPublisher` runs only AFTER_COMMIT (no nontransactional fallback), declares
the durable topology, sends persistent JSON with mandatory routing, and waits up to
5 seconds for the correlated broker confirm. A return (`NO_ROUTE`), nack, timeout,
or connection/declaration failure is logged as an error **after the mutation has
committed**; it does not fail the business response. A confirm acknowledges broker
acceptance, not Chat processing or browser receipt.

DM creation registers its event inside `DirectMessageCreationService`, which owns
the creation transaction. Looking up an existing DM (including a uniqueness-race
loser) emits no creation event. Existing locks, permissions, succession and DM
uniqueness constraints are unchanged.

Chat converts JSON into its local `RoomChangedMessage` record, validates all fields
and recipients, deletes history only for explicit actual room deletion, invalidates
the room-members cache, and sends the listed users `{"room_id": <numeric ID>}` on
all their open sockets. `ROOM_ADDED`, `ROOM_UPDATED`, `ROOM_REMOVED` map respectively
to the existing `room.added`, `room.updated`, `room.removed` constants. No subscription
is needed for these user-level events.

## Wire contract

Content type: `application/json`. UTF-8 example:

```json
{
  "roomId": "42",
  "change": "ROOM_UPDATED",
  "userIds": ["a215c5f8-d810-4518-ad4c-8d551eb6dfc4"],
  "roomDeleted": false
}
```

- `roomId`: positive decimal string, within Java's signed 64-bit integer range.
- `change`: exactly `ROOM_ADDED`, `ROOM_UPDATED`, or `ROOM_REMOVED`.
- `userIds`: array of UUID strings for the explicitly selected recipients.
- `roomDeleted`: boolean; true is allowed only with `ROOM_REMOVED` and only emitted
  when the room row is deleted. Empty recipients are allowed for this deletion.

Departures, kicks and ownership transfers have `roomDeleted=false`. A departing
owner receives `ROOM_REMOVED`; remaining members receive `ROOM_UPDATED`. The last
owner's departure also registers an explicit deletion event, even though there are
no remaining recipients. `ROOM_REMOVED` alone never authorizes history deletion.

Org uses Boot 4.1 / Jackson 3's `JacksonJsonMessageConverter`; Chat uses Boot 3.5 /
Jackson 2's `Jackson2JsonMessageConverter`. Each has a dedicated AMQP mapper and
explicit `@JsonProperty` names, independent of HTTP SNAKE_CASE. Org removes the
Java type header; Chat infers its local concrete listener record. No shared Java
package or Java-native serialization is required. The old notification gRPC client,
handler and Chat server are removed; synchronous identity and Org room/membership
RPCs remain. Proto definitions are retained to avoid unrelated cleanup.

## Topology and failure handling

Both services declare the same durable objects, so Org can publish before Chat has
ever started:

| Object | Name | Routing key |
| --- | --- | --- |
| Direct exchange | `guildchat.room-events` | `room.changed` |
| Chat queue | `guildchat.chat-service.room-events` | `room.changed` |
| Dead-letter direct exchange | `guildchat.room-events.dead` | `room.changed` |
| Dead-letter queue | `guildchat.chat-service.room-events.dead` | `room.changed` |

The existing main queue keeps its original arguments; no queue replacement or
purging is needed. Spring's built-in stateless listener retry makes at most three
attempts, with 500ms then 1s delays. Its `RepublishMessageRecovererWithConfirms`
republishes exhausted deliveries (including malformed JSON) to the durable DLQ as
persistent messages, with diagnostic headers, and waits for broker confirmation.
This avoids adding incompatible DLX arguments to an already existing queue.
AUTO acknowledgement occurs after successful handling or confirmed recovery.
Recovery failure is logged and rejected with `default-requeue-rejected=false`;
there is no immediate infinite requeue loop. The DLQ has no automatic consumer or
replay worker. Investigate failures before any deliberate replay.

## Configuration

| Variable/property | Use |
| --- | --- |
| `RABBITMQ_DEFAULT_USER` | Required broker username; passed by Compose to both services |
| `RABBITMQ_DEFAULT_PASS` | Required broker password; passed by Compose to both services |
| `RABBITMQ_HOST` | Optional hostname override; default `rabbitmq` |
| `spring.rabbitmq.port` | Internal AMQP port, 5672 |
| `room-events.confirm-timeout-ms` | Org confirm wait; default 5000 |

Both services enable correlated publisher confirms, publisher returns, and
mandatory sends. Chat's listener acknowledgement and retry settings are explicit
in `application.properties`. No fallback RabbitMQ credentials exist. Compose reuses
the existing container/volume, waits for broker health, leaves AMQP internal, and
keeps management access at `127.0.0.1:15672`. No credentials or existing volumes
were changed. For host-only local tests use a separate broker with a random
loopback port rather than exposing the application broker.

## Reliability limits

There is **no outbox or publishing worker**. A process crash after database commit,
or any publication failure, can lose the notification permanently. Publication
waits in the request's after-commit callback; slow broker/declaration/confirm paths
can delay the response even though the mutation has already committed. A timeout
is an unknown outcome: the broker may already have accepted the message.

Retries/redelivery may repeat socket notifications or cache invalidation; there is
no deduplication store, ordering guarantee across publishers, or exactly-once
processing. Deletion by room ID is safe to repeat. A partial consumer failure can
repeat earlier effects. If dead-letter republication itself fails, rejection can
lose that delivery because the unchanged main queue has no broker DLX policy.
Persistent classic queues and confirms do not guarantee survival of every broker
failure. Monitor publication errors and DLQ recovery errors.

WebSocket delivery remains best effort: offline users and broken sockets miss
notifications. Clients must refetch on reconnect. A missed event can leave Chat's
membership cache stale until another event or restart. This change does not alter
existing open-room subscription behavior.

## Verification and reproduction

The ordinary suites include JSON contract/consumer tests, mocked publisher failure
checks, real H2 transaction/rollback/ownership/DM tests, and disposable MongoDB and
WebSocket integration tests. The WebSocket room-change test invokes JSON conversion
and the consumer directly, so it is not a broker test.

Two opt-in broker tests must run in order against the **same disposable broker**.
They never use the application broker. Example (Docker and Java 21/Maven required):

```sh
docker run --rm -d --name guildchat-room-events-test \
  -e RABBITMQ_DEFAULT_USER=room_test \
  -e RABBITMQ_DEFAULT_PASS=isolated_test_only \
  -p 127.0.0.1::5672 rabbitmq:4.2-alpine
docker port guildchat-room-events-test 5672
# Wait for startup; export only the numeric mapped port printed above.
export ROOM_EVENTS_TEST_PORT=55839
mvn -f application/org-service/pom.xml -Dtest=RoomEventBrokerTest test
mvn -f application/chat-service/pom.xml -Dtest=RoomEventsBrokerTest test
docker stop guildchat-room-events-test
```

Org's test declares the topology without Chat, checks persistent JSON and real
mandatory returns, then leaves a Jackson 3 publication for Chat. Chat consumes that
publication with Jackson 2 and checks another synthetic update, malformed JSON,
invalid recipients, and exactly three attempts for a failing deletion before DLQ
recovery. Sockets/cache/repository are mocked in these broker tests; actual room
history scoping is verified separately against disposable MongoDB.

### Results (2026-10-20)

- Org: 41 tests passed, including 21 H2 ownership/transaction/DM tests and one
  actual RabbitMQ publisher test. Publisher error/logging scenarios use mocks.
- Chat: 254 tests passed, including real disposable MongoDB/WebSocket tests, five
  focused conversion/consumer tests, and one actual RabbitMQ interoperability /
  retry / DLQ test. Broker-test sockets/cache/repository use mocks.
- The two broker tests used a fresh `rabbitmq:4.2-alpine` container with no volume,
  listening only on a random loopback port. Testcontainers used disposable MongoDB.
- `docker compose config --quiet` and `git diff --check` passed.
- No production queue/data was used. No commit, push, deployment or owner message.

## Chat owner handoff (ready to send)

> Org room-change notifications now use RabbitMQ only. In Chat, changed
> `config/RabbitMQConfig.java` (dedicated Jackson 2 converter, compatible durable
> topology, confirmed DLQ recovery), `messaging/RoomChangedMessage.java` (explicit
> camelCase JSON), `messaging/RoomChangedConsumer.java` (validation before effects,
> `ROOM_ADDED` → `room.added`, explicit deletion only),
> `repository/MessageRepository.java` (`deleteByRoomId(Long)`), and
> `src/main/resources/application.properties` (required `RABBITMQ_DEFAULT_USER` /
> `RABBITMQ_DEFAULT_PASS`, AUTO ack, three attempts, confirms/returns). Removed
> `grpc/ChatGrpcServer.java` and `grpc/ChatNotifyGrpcService.java`; the server had
> only the obsolete notification RPC. Synchronous identity/Org clients remain.
> `grpc/RoomMembersCache.java` has a comment update only. Cache invalidation and
> listed-user socket payloads stay intact; departures/kicks/transfers never delete
> history. Notification tests were replaced/updated, MongoTestSupport disables
> broker access in nonbroker tests, and API_CONTRACT.md documents AMQP. All 254
> Chat tests passed, including isolated broker delivery/retry/DLQ checks and real
> MongoDB room-scoped deletion. See docs/room-events.md for the schema, test
> commands and reliability limits: no outbox, duplicates possible, no guaranteed
> browser delivery. No live credentials or application data changed.
