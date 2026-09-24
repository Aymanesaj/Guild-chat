import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import Sidebar from "./Sidebar";
import MainPanel from "./MainPanel";
import ProfileOverlay from "./ProfileOverlay";
import { ProfileOverlayProvider, useProfileOverlay } from "./ProfileOverlayContext";
import { RoomNavigationProvider } from "./RoomNavigationContext";
import { NavDrawerProvider } from "./NavDrawerContext";
import ProfilePreviewPopover from "../profile/ProfilePreviewPopover";
import { SlidePanel } from "../ui";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { PHONE_QUERY } from "../../constants/breakpoints";
import { connectChat } from "../../api/messages";

const AppShellRoot = styled.div`
  display: flex;
  height: 100vh;
  /* Mobile browsers count the collapsing URL bar in 100vh, which pushes the
     composer under it. dvh tracks the visible viewport instead. */
  height: 100dvh;
  overflow: hidden;
`;

const MainContent = styled.main`
  position: relative;
  min-width: 0;
  flex: 1;
  background: var(--bg-base);

  &::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 42px;
    content: "";
    pointer-events: none;
    background: linear-gradient(to right, rgba(0, 0, 0, 0.18), transparent);
  }
`;

function AppShellContent({ onLogout }) {
  const [isDirectMessages, setIsDirectMessages] = useState(true);
  const [activeRoomId, setActiveRoomId] = useState(null);

  const isPhone = useMediaQuery(PHONE_QUERY);
  const [isNavOpen, setIsNavOpen] = useState(false);

  const { profile, closeProfile, previewUser, closeUserPreview } = useProfileOverlay();

  const openNav = useCallback(() => setIsNavOpen(true), []);
  const closeNav = useCallback(() => setIsNavOpen(false), []);

  const navDrawer = useMemo(
    () => ({ isPhone, isNavOpen, openNav, closeNav }),
    [isPhone, isNavOpen, openNav, closeNav],
  );

  // Document listeners fire in registration order, and the shell registers
  // before any overlay opened later, so Escape has to be yielded explicitly to
  // whatever is stacked on top of the drawer.
  useEscapeKey(closeNav, isPhone && isNavOpen && !profile && !previewUser);

  function handleRoomChange(roomId) {
    setActiveRoomId(roomId);
    setIsDirectMessages(false);
    setIsNavOpen(false);
  }

  function handleDirectMessages() {
    setIsDirectMessages(true);
    setIsNavOpen(false);
  }

  return (
    <NavDrawerProvider value={navDrawer}>
      <RoomNavigationProvider navigateToRoom={handleRoomChange}>
        <AppShellRoot>
          {/* Wrapped on both sides of the breakpoint and in the same tree slot:
              swapping the wrapper in and out would remount Sidebar on rotation. */}
          <SlidePanel
            $asOverlay={isPhone}
            $open={!isPhone || isNavOpen}
            $side="left"
            onClose={closeNav}
          >
            <Sidebar
              isDirectMessages={isDirectMessages}
              activeRoomId={activeRoomId?.id}
              onRoomChange={handleRoomChange}
              onDirectMessages={handleDirectMessages}
              onLogout={onLogout}
            />
          </SlidePanel>

          <MainContent>
            <MainPanel
              activeView={isDirectMessages ? true : activeRoomId}
            />
          </MainContent>
        </AppShellRoot>

        {profile && (
          <ProfileOverlay
            user={profile}
            onClose={closeProfile}
          />
        )}

        {previewUser && (
          <ProfilePreviewPopover
            target={previewUser}
            onClose={closeUserPreview}
          />
        )}
      </RoomNavigationProvider>
    </NavDrawerProvider>
  );
}

function AppShell({ user, onLogout }) {
  // Only mounted while logged in: the chat socket stays open for the whole
  // session, which is what makes the user "online". Logout closes it.
  useEffect(() => {
    connectChat();
  }, []);

  return (
    <ProfileOverlayProvider user={user}>
      <AppShellContent onLogout={onLogout} />
    </ProfileOverlayProvider>
  );
}

export default AppShell;