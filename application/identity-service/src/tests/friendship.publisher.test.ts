
import { EventEmitter } from "node:events";
import type { ConfirmChannel } from "amqplib";
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { connectRabbitMQMock } = vi.hoisted(() => ({
  connectRabbitMQMock: vi.fn(),
}));

vi.mock("../messaging/rabbitmq.connection.js", () => ({
  connectRabbitMQ: connectRabbitMQMock,
}));

import { publishFriendshipEvent } from "../messaging/friendship.publisher.js";

const friendship = {
  friendshipId: "friendship-123",
  requesterId: "alice-id",
  addresseeId: "bob-id",
};

let channel: EventEmitter & {
  assertExchange: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
};

function simulateConfirmation(): void {
  channel.publish.mockImplementation((...args: unknown[]) => {
    const callback = args[4] as (error: Error | null) => void;

    callback(null);
    return true;
  });
}

beforeEach(() => {
  channel = Object.assign(new EventEmitter(), {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn(),
  });

  connectRabbitMQMock.mockReset();
  connectRabbitMQMock.mockResolvedValue(
    channel as unknown as ConfirmChannel,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Friendship RabbitMQ publisher", () => {
  it("publishes FRIEND_REQUEST_SENT as persistent JSON", async () => {
    simulateConfirmation();

    await publishFriendshipEvent(
      "FRIEND_REQUEST_SENT",
      friendship,
    );

    expect(channel.assertExchange).toHaveBeenCalledWith(
      "guildchat.friendship-events",
      "direct",
      { durable: true },
    );

    expect(channel.publish).toHaveBeenCalledWith(
      "guildchat.friendship-events",
      "friendship.request.sent",
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        mandatory: true,
        contentType: "application/json",
        messageId: expect.any(String),
      }),
      expect.any(Function),
    );

    const message = channel.publish.mock.calls[0][2] as Buffer;
    const event = JSON.parse(message.toString());

    expect(event).toEqual(
      expect.objectContaining({
        eventType: "FRIEND_REQUEST_SENT",
        version: 1,
        ...friendship,
        eventId: expect.any(String),
        occurredAt: expect.any(String),
      }),
    );
  });

  it("publishes FRIEND_REQUEST_ACCEPTED with the correct routing key", async () => {
    simulateConfirmation();

    await publishFriendshipEvent(
      "FRIEND_REQUEST_ACCEPTED",
      friendship,
    );

    expect(channel.publish).toHaveBeenCalledWith(
      "guildchat.friendship-events",
      "friendship.request.accepted",
      expect.any(Buffer),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("rejects when RabbitMQ negatively acknowledges a message", async () => {
    channel.publish.mockImplementation((...args: unknown[]) => {
      const callback = args[4] as (error: Error | null) => void;

      callback(new Error("Broker rejected message"));
      return true;
    });

    await expect(
      publishFriendshipEvent("FRIEND_REQUEST_SENT", friendship),
    ).rejects.toThrow("Broker rejected message");
  });

  it("rejects an unroutable message", async () => {
    channel.publish.mockImplementation((...args: unknown[]) => {
      const options = args[3] as { messageId: string };
      const callback = args[4] as (error: Error | null) => void;

      // Simulate RabbitMQ returning an unroutable message.
      channel.emit("return", {
        properties: {
          messageId: options.messageId,
        },
      });

      // The broker can still positively confirm the publication.
      callback(null);

      return true;
    });

    await expect(
      publishFriendshipEvent("FRIEND_REQUEST_SENT", friendship),
    ).rejects.toThrow("unroutable message");
  });

  it("rejects when the channel closes before confirmation", async () => {
    channel.publish.mockImplementation(() => {
      channel.emit("close");
      return true;
    });

    await expect(
      publishFriendshipEvent("FRIEND_REQUEST_SENT", friendship),
    ).rejects.toThrow("channel closed");
  });

  it("rejects when confirmation times out", async () => {
    vi.useFakeTimers();

    // No confirmation callback: simulate an unresponsive broker.
    channel.publish.mockReturnValue(true);

    const publishing = publishFriendshipEvent(
      "FRIEND_REQUEST_SENT",
      friendship,
    );

    const assertion = expect(publishing).rejects.toThrow(
      "confirmation timed out",
    );

    await vi.advanceTimersByTimeAsync(5000);

    await assertion;
  });
});
