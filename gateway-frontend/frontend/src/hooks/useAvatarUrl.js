import { useEffect, useState } from "react";
import { getAvatarObjectUrl, peekAvatarObjectUrl } from "../api/profile";

/**
 * Resolves an avatar path to a displayable object URL.
 *
 * The URL is read straight from the shared cache during render, so an avatar
 * that another row already loaded shows up with no fetch and no flash. Only a
 * genuine cache miss goes to the network, and the object URL is not revoked on
 * unmount — the cache owns it and clears on logout.
 */
export function useAvatarUrl(avatarFile) {
  const [, setResolved] = useState(0);

  const cached = peekAvatarObjectUrl(avatarFile);

  useEffect(() => {
    // Already settled (a URL or a known miss): nothing to fetch.
    if (!avatarFile || peekAvatarObjectUrl(avatarFile) !== undefined) return undefined;

    let cancelled = false;
    getAvatarObjectUrl(avatarFile).then(() => {
      if (!cancelled) setResolved((tick) => tick + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [avatarFile]);

  return {
    avatarUrl: cached ?? null,
    loading: Boolean(avatarFile) && cached === undefined,
  };
}
