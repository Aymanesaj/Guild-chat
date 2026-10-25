import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { TbCheck, TbChevronDown } from "react-icons/tb";
import { IconButton } from "../ui";
import MemberActionsMenu from "../rooms/MemberActionsMenu";

// The menu must sit above the profile and mobile notification overlays.
const MenuLayer = styled.div`
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-overlay) + 1);
`;

export default function NotificationOptionsButton({ feed }) {
  const [menuRect, setMenuRect] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function closeMenu() {
    setMenuRect(null);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!menuRect) return undefined;
    menuRef.current?.querySelector("button:not(:disabled)")?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        // Handle this before the mobile overlay's document listener.
        event.preventDefault();
        closeMenu();
      } else if (event.key === "Tab") {
        closeMenu();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [menuRect]);

  return (
    <>
      <IconButton
        ref={triggerRef}
        type="button"
        $size={26}
        aria-label="Notification options"
        title="Notification options"
        aria-haspopup="menu"
        aria-expanded={Boolean(menuRect)}
        onClick={(event) => setMenuRect(event.currentTarget.getBoundingClientRect())}
      >
        <TbChevronDown size={18} />
      </IconButton>
      {menuRect && createPortal(
        <MenuLayer ref={menuRef}>
          <MemberActionsMenu
            anchorRect={menuRect}
            actions={[
              { key: "read-all", label: "Mark all read", icon: TbCheck,
                disabled: feed.unread === 0, onSelect: feed.markAllRead },
            ]}
            onClose={closeMenu}
          />
        </MenuLayer>,
        document.body,
      )}
    </>
  );
}
