export type FriendshipEventType =
  | "FRIEND_REQUEST_SENT"
  | "FRIEND_REQUEST_ACCEPTED";

export interface FriendshipEvent {
  eventId: string;
  eventType: FriendshipEventType;
  version: 1;
  friendshipId: string;
  requesterId: string;
  addresseeId: string;
  occurredAt: string;
}