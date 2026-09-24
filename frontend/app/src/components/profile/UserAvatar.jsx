import { Avatar } from "../ui";
import { useAvatarUrl } from "../../hooks/useAvatarUrl";

/**
 * An `Avatar` that resolves its own image from an identity avatar path.
 *
 * `Avatar` stays a dumb primitive that takes a ready `src`; this is the wired
 * version for the many places that hold a user (message sender, member row, DM
 * row) rather than an already-fetched blob. Falls back to the initial while it
 * loads and when the user has no avatar, so there is nothing to special-case.
 */
function UserAvatar({ avatar, name, $size = 36, ...rest }) {
  const { avatarUrl } = useAvatarUrl(avatar);

  return <Avatar src={avatarUrl} name={name} $size={$size} {...rest} />;
}

export default UserAvatar;
