
import amqp, {
  type ChannelModel,
  type ConfirmChannel,
} from "amqplib";

let connection: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;

// Tracks a connection attempt currently in progress.
let connecting: Promise<ConfirmChannel> | null = null;

async function openRabbitMQ(): Promise<ConfirmChannel> {
  const host = process.env.RABBITMQ_HOST ?? "rabbitmq";
  const port = Number(process.env.RABBITMQ_PORT ?? "5672");

  const username = process.env.RABBITMQ_DEFAULT_USER;
  const password = process.env.RABBITMQ_DEFAULT_PASS;

  if (!username || !password) {
    throw new Error("RabbitMQ credentials are not configured");
  }

  const url = new URL(`amqp://${host}:${port}`);
  url.username = username;
  url.password = password;

  const newConnection = await amqp.connect(url.toString());

  newConnection.on("error", (error) => {
    console.error("RabbitMQ connection error:", error);
  });

  newConnection.on("close", () => {
    if (connection === newConnection) {
      connection = null;
      channel = null;
    }
  });

  try {
    const newChannel = await newConnection.createConfirmChannel();

    newChannel.on("error", (error) => {
      console.error("RabbitMQ channel error:", error);
    });

    newChannel.on("close", () => {
      if (channel === newChannel) {
        channel = null;
        connection = null;

        // Do not leave the underlying connection open
        // when its publishing channel has closed.
        void newConnection.close().catch(() => {});
      }
    });

    connection = newConnection;
    channel = newChannel;

    return newChannel;
  } catch (error) {
    await newConnection.close().catch(() => {});
    throw error;
  }
}

export function connectRabbitMQ(): Promise<ConfirmChannel> {
  // Reuse an established channel.
  if (channel) {
    return Promise.resolve(channel);
  }

  // Reuse the ongoing connection attempt.
  if (connecting) {
    return connecting;
  }

  // Only the first caller starts a new connection.
  connecting = openRabbitMQ().finally(() => {
    connecting = null;
  });

  return connecting;
}

export async function closeRabbitMQ(): Promise<void> {
  // Wait for any in-progress connection attempt.
  if (connecting) {
    try {
      await connecting;
    } catch {
      // No connection to close if startup failed.
    }
  }

  const currentChannel = channel;
  const currentConnection = connection;

  channel = null;
  connection = null;

  if (currentChannel) {
    await currentChannel.close().catch(() => {});
  }

  if (currentConnection) {
    await currentConnection.close().catch(() => {});
  }
}
