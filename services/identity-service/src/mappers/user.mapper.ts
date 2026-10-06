import type { User , PublicUser } from "../types/user.types.js";

export function toPublicUser(
  user: User
): PublicUser {
  const {
    passwordHash,
    oauthProviderId,
    ...publicUser
  } = user;

  return publicUser;
}