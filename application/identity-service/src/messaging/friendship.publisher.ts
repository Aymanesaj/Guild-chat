
import type { ConfirmChannel } from "amqplib";
import { randomUUID } from "node:crypto";
import { connectRabbitMQ } from "./rabbitmq.connection.js";
import type {
  FriendshipEvent,
  FriendshipEventType,
} from "./friendship.events.js";

const EXCHANGE = "guildchat.friendship-events";

const ROUTING_KEYS: Record<FriendshipEventType, string> = {
  FRIEND_REQUEST_SENT: "friendship.request.sent",
  FRIEND_REQUEST_ACCEPTED: "friendship.request.accepted",
};

export type FriendshipEventData = Pick<
  FriendshipEvent,
  "friendshipId" | "requesterId" | "addresseeId"
>;

export async function publishFriendshipEvent(
  eventType: FriendshipEventType,
  data: FriendshipEventData,
): Promise<void> {
  const channel = await connectRabbitMQ();

  await channel.assertExchange(EXCHANGE, "direct", {
    durable: true,
  });

  const event: FriendshipEvent = {
    eventId: randomUUID(),
    eventType,
    version: 1,
    ...data,
    occurredAt: new Date().toISOString(),
  };

  const message = Buffer.from(JSON.stringify(event));

  await publishConfirmed(
    channel,
    ROUTING_KEYS[eventType],
    message,
  );
}


function publishConfirmed(
  channel: ConfirmChannel,
  routingKey: string,
  message: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const messageId = randomUUID();
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      channel.off("return", onReturn);
      channel.off("close", onClose);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onReturn = (returned: {
      properties: { messageId?: string };
    }) => {
      if (returned.properties.messageId === messageId) {
        fail(new Error("RabbitMQ returned an unroutable message"));
      }
    };

    const onClose = () => {
      fail(new Error("RabbitMQ channel closed before confirmation"));
    };

    const timeout = setTimeout(() => {
      fail(new Error("RabbitMQ publisher confirmation timed out"));
    }, 5000);

    channel.on("return", onReturn);
    channel.on("close", onClose);

    try {
      channel.publish(
        EXCHANGE,
        routingKey,
        message,
        {
          persistent: true,
          contentType: "application/json",
          mandatory: true,
          messageId,
        },
        (error) => {
          if (error) {
            fail(error);
          } else {
            succeed();
          }
        },
      );
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
