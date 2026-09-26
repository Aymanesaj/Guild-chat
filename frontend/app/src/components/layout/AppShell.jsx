import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { usePolling } from "../../hooks/usePolling";
import { PHONE_QUERY } from "../../constants/breakpoints";
import { connectChat } from "../../api/messages";
import { getRooms } from "../../api/rooms";

/**
 * org-service has no way to push membership changes (no websocket dependency,
 * no path into chat-service), so being added to or removed from a room is only
 * observable by asking again. Polled from the shell rather than the sidebar so
 * it keeps running whichever view is open.
 */
const ROOMS_POLL_MS = 10_000;

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

  const { profile, closeProfile, previewUser, closeUserPreview, roomsRefreshTick } =
    useProfileOverlay();

  const [rooms, setRooms] = useState([]);
  const [roomsState, setRoomsState] = useState("loading");
  // Bumped by every local write to the list. A poll captures it when it starts
  // and drops its response if it changed meanwhile, so a request already in
  // flight can't resurrect a room the user just left or erase one they just
  // created — the latter would also trip the removal guard below.
  const mutationSeq = useRef(0);

  const loadRooms = useCallback(async () => {
    const seq = mutationSeq.current;

    try {
      const data = await getRooms();
      if (seq !== mutationSeq.current) return;
      setRooms(data);
      setRoomsState("success");
    } catch {
      // A failed tick keeps the rooms already on screen; only a first load with
      // nothing to show is an error the sidebar should report.
      setRoomsState((state) => (state === "loading" ? "error" : state));
    }
  }, []);

  // Leaving a room reports itself through the context tick rather than through
  // addRoom, so invalidate here too: without this, a poll issued just before the
  // leave can land afterwards and list the room again until the next tick.
  useEffect(() => {
    mutationSeq.current += 1;
  }, [roomsRefreshTick]);

  // The tick also reruns the fetch immediately, so a room the user leaves goes
  // away at once instead of staying listed for up to ROOMS_POLL_MS.
  usePolling(loadRooms, ROOMS_POLL_MS, roomsRefreshTick);

  const addRoom = useCallback((room) => {
    // Bump before inserting, so a poll issued before the room existed is
    // discarded rather than removing it again.
    mutationSeq.current += 1;
    setRooms((previous) => [room, ...previous]);
    setRoomsState("success");
  }, []);

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

  const handleRoomChange = useCallback((roomId) => {
    setActiveRoomId(roomId);
    setIsDirectMessages(false);
    setIsNavOpen(false);
  }, []);

  const handleDirectMessages = useCallback(() => {
    setIsDirectMessages(true);
    setIsNavOpen(false);
  }, []);

  // A loaded list that no longer contains the open room means we were removed
  // from it. Without this the room view stays mounted and subscribed while the
  // sidebar no longer lists it.
  //
  // Only group rooms can be judged this way: `rooms` comes from GET /rooms,
  // which org-service scopes to group rooms (DMs live under /rooms/dm), so a DM
  // is never in it and testing one here would close it the moment it opened.
  // Guarded on "success" too, so neither the first empty list nor a failed tick
  // can eject anyone.
  useEffect(() => {
    if (roomsState !== "success") return;
    if (activeRoomId?.type !== "group") return;
    if (rooms.some((room) => room.id === activeRoomId.id)) return;
    handleDirectMessages();
  }, [rooms, roomsState, activeRoomId, handleDirectMessages]);

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
              rooms={rooms}
              roomsState={roomsState}
              onRoomCreated={addRoom}
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