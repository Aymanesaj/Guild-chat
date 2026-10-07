export function createFriendshipPairKey(
  userA: string,
  userB: string
): string {
  return [userA, userB]
    .map((id) => id.toLowerCase())
    .sort()
    .join(":");
}