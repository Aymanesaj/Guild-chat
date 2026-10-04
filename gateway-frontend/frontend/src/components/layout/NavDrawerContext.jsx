import { createContext, useContext } from "react";
import { TbMenu2 } from "react-icons/tb";
import { IconButton } from "../ui";

const NavDrawerContext = createContext({
  isPhone: false,
  isNavOpen: false,
  openNav: () => {},
  closeNav: () => {},
});

/**
 * Whether the shell is in phone layout, and the open state of the navigation
 * drawer. Kept separate from RoomNavigationContext: that one's value is a new
 * object every render, so folding drawer state into it would re-render the DM
 * list and every room row on each toggle.
 */
export function NavDrawerProvider({ value, children }) {
  return (
    <NavDrawerContext.Provider value={value}>
      {children}
    </NavDrawerContext.Provider>
  );
}

export function useNavDrawer() {
  return useContext(NavDrawerContext);
}

/** Renders nothing on desktop, where the sidebar is always on screen. */
export function NavToggleButton() {
  const { isPhone, openNav } = useNavDrawer();

  if (!isPhone) {
    return null;
  }

  return (
    <IconButton type="button" onClick={openNav} aria-label="Open navigation">
      <TbMenu2 size={20} />
    </IconButton>
  );
}
