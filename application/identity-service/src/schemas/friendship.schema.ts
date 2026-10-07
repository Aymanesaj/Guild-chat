import { z } from "zod";

export const sendFriendRequestSchema = z.object({
  addresseeId: z.uuid("Invalid addressee id"),
});

export type SendFriendRequestInput = z.infer<typeof sendFriendRequestSchema>;

export const friendRequestParamsSchema = z.object({
  id: z.uuid("Invalid friend request id"),
});

export type FriendRequestParams = z.infer<typeof friendRequestParamsSchema>;

export const friendUserParamsSchema = z.object({
  userId: z.uuid("Invalid user id"),
});

export type FriendUserParams = z.infer<typeof friendUserParamsSchema>;
