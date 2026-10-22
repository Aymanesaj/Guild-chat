import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { TbDots, TbEdit, TbLogout, TbPencil } from "react-icons/tb";
import { getMyRoomRole, leaveRoom } from "../../api/rooms";
import MemberActionsMenu from "../rooms/MemberActionsMenu";
import { ConfirmDialog, IconButton } from "../ui";
import { useToast } from "../ui/ToastProvider";
import RoomDetailsDialog from "./RoomDetailsDialog";

const Trigger = styled(IconButton)`
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  pointer-events: none;

  &[aria-expanded="true"], &:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }

  @media (hover: none) {
    opacity: 1;
    pointer-events: auto;
  }
`;

// Portals escape the scrollable room list and sit above the mobile drawer.
const ActionLayer = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
`;

function RoomOptionsButton({ room, onRoomUpdated, onRoomLeft }) {
  const [menuRect, setMenuRect] = useState(null);
  const [permission, setPermission] = useState(null);
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef(null);
  const actionLayerRef = useRef(null);
  const toast = useToast();

  // Resolve permissions only when requested. A new room snapshot also refreshes
  // an open menu after a role change; old permissions never apply to that snapshot.
  useEffect(() => {
    if (!menuRect) return undefined;
    let cancelled = false;
    getMyRoomRole(room.id)
      .then((role) => {
        if (!cancelled) setPermission({ room, role });
      })
      .catch((err) => {
        if (!cancelled) toast.error(err?.message || "Failed to load room permissions");
      });
    return () => { cancelled = true; };
  }, [menuRect, room, toast]);

  function closeMenu() {
    setMenuRect(null);
    triggerRef.current?.focus();
  }

  function closeAction() {
    if (busy) return;
    setAction(null);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (action === "leave") actionLayerRef.current?.querySelector("button")?.focus();
  }, [action]);

  // The shell's document listener otherwise closes the mobile drawer first.
  useEffect(() => {
    if (!menuRect) return undefined;
    function handleEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuRect(null);
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [menuRect]);

  async function handleLeave() {
    if (busy) return;
    setBusy(true);
    try {
      await leaveRoom(room.id);
      onRoomLeft(room.id);
      toast.success(`You left #${room.name}.`);
      setAction(null);
    } catch (err) {
      toast.error(err?.message || "Failed to leave room");
    } finally {
      setBusy(false);
    }
  }

  const role = permission?.room === room ? permission.role : null;
  const canEdit = role === "owner" || role === "admin";
  const actions = [];
  if (canEdit) {
    actions.push(
      { key: "rename", label: "Rename room", icon: TbPencil, onSelect: () => setAction("rename") },
      { key: "description", label: "Edit description", icon: TbEdit, onSelect: () => setAction("description") },
    );
  }
  actions.push({
    key: "leave", label: "Leave room", icon: TbLogout, danger: true,
    onSelect: () => setAction("leave"),
  });

  return (
    <>
      <Trigger
        ref={triggerRef}
        className="room-options-trigger"
        type="button"
        $size={28}
        aria-label={`Options for ${room.name}`}
        title={`Options for ${room.name}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(menuRect)}
        onClick={(event) => {
          setPermission(null);
          setMenuRect(event.currentTarget.getBoundingClientRect());
        }}
      >
        <TbDots size={18} />
      </Trigger>
      {menuRect && createPortal(
        <MemberActionsMenu anchorRect={menuRect} actions={actions} onClose={closeMenu} />,
        document.body,
      )}
      {action === "leave" && createPortal(
        <ActionLayer
          ref={actionLayerRef}
          onKeyDownCapture={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closeAction();
          }}
        >
          <ConfirmDialog
            open
            title={`Leave #${room.name}?`}
            text="You will lose access to this room. An owner or admin will need to add you again to rejoin."
            confirmLabel="Leave room"
            busyLabel="Leaving..."
            busy={busy}
            onConfirm={handleLeave}
            onCancel={closeAction}
          />
        </ActionLayer>,
        document.body,
      )}
      {(action === "rename" || action === "description") && createPortal(
        <ActionLayer>
          <RoomDetailsDialog room={room} mode={action} onUpdated={onRoomUpdated} onClose={closeAction} />
        </ActionLayer>,
        document.body,
      )}
    </>
  );
}

export default RoomOptionsButton;
