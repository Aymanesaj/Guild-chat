import type { AuthProvider } from "../generated/prisma/enums.js";

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  authProvider: AuthProvider;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResponse {
  tokenType: "Bearer";
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}