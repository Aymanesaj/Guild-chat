import styled from "styled-components";
import { TbBell } from "react-icons/tb";
import { IconButton } from "../ui";
import { formatUnread } from "../../utils/notifications";

const BellButton = styled(IconButton)`
  position: relative;
`;

/** Red count on the bell, and on rooms and DMs (exported for them). */
export const UnreadBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--danger);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
`;

const BellBadge = styled(UnreadBadge)`
  position: absolute;
  top: -4px;
  right: -6px;
  box-shadow: 0 0 0 2px var(--bg-surface);
`;

function NotificationBell({ unread, onClick }) {
  return (
    <BellButton
      type="button"
      onClick={onClick}
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      aria-haspopup="dialog"
      title="Notifications"
    >
      <TbBell size={20} />
      {unread > 0 && <BellBadge aria-hidden="true">{formatUnread(unread)}</BellBadge>}
    </BellButton>
  );
}

export default NotificationBell;
