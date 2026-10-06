import type { PublicUser } from "./user.types.js";

export interface AuthResponse {
  tokenType: "Bearer";
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}