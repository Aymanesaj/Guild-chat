import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { TbCheck, TbChevronDown, TbHash, TbMessageCircle, TbTrash, TbUsers } from "react-icons/tb";
import { Button, IconButton } from "../ui";
import { useToast } from "../ui/ToastProvider";
import MemberActionsMenu from "./MemberActionsMenu";
import { NavToggleButton } from "../layout/NavDrawerContext";

const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
`;

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: var(--text-tertiary);

  h2 {
    overflow: hidden;
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-lg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

/* The header now also carries a hamburger on phones; at 360px the label is
   what has to give. */
const MembersButton = styled(Button)`
  @media (max-width: 700px) {
    span {
      display: none;
    }
  }
`;

function RoomHeader({ roomName, isDm, onToggleMembers, onHideDm, onMarkRead }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const triggerRef = useRef(null);
  const actionPending = useRef(false);
  const runAction = async (action) => {
    if (actionPending.current || !action) return;
    actionPending.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error?.message || "Couldn't update this conversation.");
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const closeMenu = () => {
    setMenuRect(null);
    triggerRef.current?.focus();
  };
  const TitleIcon = isDm ? TbMessageCircle : TbHash;

  return (
    <PanelHeader>
      <HeaderTitle>
        <NavToggleButton />
        <TitleIcon size={20} />
        <h2>{roomName}</h2>
      </HeaderTitle>

      {isDm && onHideDm && (
        <>
          <IconButton
            ref={triggerRef}
            type="button"
            aria-label="Conversation options"
            title="Conversation options"
            aria-haspopup="menu"
            aria-expanded={Boolean(menuRect)}
            disabled={busy}
            onClick={(event) => setMenuRect(event.currentTarget.getBoundingClientRect())}
          >
            <TbChevronDown size={20} />
          </IconButton>
          {menuRect && createPortal(
            <MemberActionsMenu
              anchorRect={menuRect}
              actions={[
                { key: "read", label: "Mark as read", icon: TbCheck, disabled: !onMarkRead || busy,
                  onSelect: () => runAction(onMarkRead) },
                { key: "delete", label: "Delete conversation", icon: TbTrash, danger: true, disabled: busy,
                  onSelect: () => runAction(onHideDm) },
              ]}
              onClose={closeMenu}
            />,
            document.body,
          )}
        </>
      )}

      {/* A DM has exactly two members and no roster to manage. */}
      {!isDm && (
        <MembersButton
          type="button"
          $variant="ghost"
          $size="sm"
          onClick={onToggleMembers}
          title="Toggle members"
          aria-label="Toggle members"
        >
          <TbUsers size={18} />
          <span>Members</span>
        </MembersButton>
      )}
    </PanelHeader>
  );
}

export default RoomHeader;
