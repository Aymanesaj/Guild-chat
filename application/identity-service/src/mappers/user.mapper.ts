import type { User , PublicUser , PublicProfile } from "../types/user.types.js";

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

export function toPublicProfile(
  user: User
): PublicProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}