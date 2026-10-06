export interface UpdateUserData {
  username?: string;
  displayName?: string;
  bio?: string | null;
}

export type AuthProvider =
  | "LOCAL"
  | "GITHUB";

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  authProvider: AuthProvider;
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