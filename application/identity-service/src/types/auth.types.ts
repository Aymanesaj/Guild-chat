import type { AuthProvider } from "../generated/prisma/enums.js";
import type { PublicUser } from "./user.types.js";

export interface AuthResponse {
  tokenType: "Bearer";
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}