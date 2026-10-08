export type FriendshipStatus =
  | "PENDING"
  | "ACCEPTED";

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  pairKey: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FriendRequestResponse {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FriendRequestsResponse {
  incoming: FriendRequestResponse[];
  outgoing: FriendRequestResponse[];
}