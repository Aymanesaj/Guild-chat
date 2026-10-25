import styled from "styled-components";

import { useEscapeKey } from "../../hooks/useEscapeKey";
import { riseIn } from "../ui";

const MENU_WIDTH = 190;
const MENU_MARGIN = 12;
const ITEM_HEIGHT = 34;
const MENU_PADDING = 8;

/* Same trick as the profile preview: the menu is fixed to the viewport, so it
   has to be nudged back inside when the trigger sits near an edge. */
function clampPosition(anchorRect, itemCount) {
  if (!anchorRect) {
    return { top: 80, left: 80 };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const height = itemCount * ITEM_HEIGHT + MENU_PADDING * 2;

  // Right-align the menu with the trigger; a roster button lives at the row's end.
  let left = anchorRect.right - MENU_WIDTH;
  if (left + MENU_WIDTH + MENU_MARGIN > viewportWidth) {
    left = viewportWidth - MENU_WIDTH - MENU_MARGIN;
  }
  left = Math.max(MENU_MARGIN, left);

  let top = anchorRect.bottom + 6;
  if (top + height > viewportHeight) {
    top = Math.max(MENU_MARGIN, anchorRect.top - height - 6);
  }

  return { top, left };
}

function MemberActionsMenu({ anchorRect, actions, onClose }) {
  useEscapeKey(onClose);

  const { top, left } = clampPosition(anchorRect, actions.length);

  return (
    <Backdrop onClick={onClose}>
      <Menu
        role="menu"
        style={{ top, left }}
        onClick={(event) => event.stopPropagation()}
      >
        {actions.map((action) => (
          <MenuItem
            key={action.key}
            type="button"
            role="menuitem"
            $danger={action.danger}
            disabled={action.disabled}
            onClick={() => {
              action.onSelect();
              onClose();
            }}
          >
            <action.icon size={16} />
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </Backdrop>
  );
}

export default MemberActionsMenu;

// =============================================================================
// Styles
// =============================================================================

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
`;

const Menu = styled.div`
  position: fixed;
  display: flex;
  flex-direction: column;
  width: ${MENU_WIDTH}px;
  padding: ${MENU_PADDING}px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  animation: ${riseIn} var(--dur) var(--ease);
  z-index: var(--z-overlay);
`;

const MenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: ${ITEM_HEIGHT}px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: ${(props) =>
    props.$danger ? "var(--danger)" : "var(--text-primary)"};
  font-size: var(--text-sm);
  text-align: left;
  transition: background var(--dur-fast) var(--ease);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:disabled {
    color: var(--text-tertiary);
    cursor: default;
  }
`;
