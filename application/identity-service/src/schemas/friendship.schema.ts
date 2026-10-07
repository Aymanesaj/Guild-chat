import { z } from "zod";

export const sendFriendRequestSchema = z.object({
  addresseeId: z.uuid("Invalid addressee id"),
});

export type SendFriendRequestInput = z.infer<typeof sendFriendRequestSchema>;
