export interface UpdateUserData {
  username?: string;
  displayName?: string;
  bio?: string | null;
}

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  authProvider: "LOCAL" | "GITHUB";
  oauthProviderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicUser = Omit<
  User,
  "passwordHash" | "oauthProviderId"
>;

export type PublicProfile = Pick<
  User,
  | "id"
  | "username"
  | "displayName"
  | "bio"
  | "avatarUrl"
  | "createdAt"
>;