import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TbCheck, TbChevronDown, TbTrash } from "react-icons/tb";
import { IconButton } from "../ui";
import { useToast } from "../ui/ToastProvider";
import MemberActionsMenu from "../rooms/MemberActionsMenu";

export default function DmOptionsButton({ onDelete, onMarkRead }) {
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
  return (
    <>
      <IconButton
        ref={triggerRef}
        type="button"
        $size={26}
        aria-label="Conversation options"
        title="Conversation options"
        aria-haspopup="menu"
        aria-expanded={Boolean(menuRect)}
        disabled={busy}
        onClick={(event) => setMenuRect(event.currentTarget.getBoundingClientRect())}
      >
        <TbChevronDown size={18} />
      </IconButton>
      {menuRect && createPortal(
        <MemberActionsMenu
          anchorRect={menuRect}
          actions={[
            { key: "read", label: "Mark as read", icon: TbCheck, disabled: !onMarkRead || busy,
              onSelect: () => runAction(onMarkRead) },
            { key: "delete", label: "Delete conversation", icon: TbTrash, danger: true, disabled: busy,
              onSelect: () => runAction(onDelete) },
          ]}
          onClose={closeMenu}
        />,
        document.body,
      )}
    </>
  );
}
