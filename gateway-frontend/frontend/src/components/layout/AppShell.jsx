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
import { PHONE_QUERY } from "../../constants/breakpoints";
import { connectChat, onRoomEvent } from "../../api/messages";
import { getRoom, getRooms } from "../../api/rooms";
import { useSocketNotifications } from "../../hooks/useSocketNotifications";
import { useToast } from "../ui/ToastProvider";
import { useMobileViewport } from "../../hooks/useMobileViewport";

const AppShellRoot = styled.div`
  display: flex;
  height: 100vh;
  /* Mobile browsers count the collapsing URL bar in 100vh, which pushes the
     composer under it. dvh tracks the visible viewport instead. */
  height: 100dvh;
  overflow: hidden;

  @media ${PHONE_QUERY} {
    position: fixed;
    top: var(--app-viewport-top, 0px);
    left: 0;
    right: 0;
    height: var(--app-viewport-height, 100dvh);
  }
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
  const toast = useToast();
  const [isDirectMessages, setIsDirectMessages] = useState(true);
  const [activeRoomId, setActiveRoomId] = useState(null);

  const isPhone = useMediaQuery(PHONE_QUERY);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const viewportRef = useMobileViewport(isPhone, isNavOpen);

  const { currentUser, profile, profileNavigation, openProfile, closeProfile, previewUser, closeUserPreview } =
    useProfileOverlay();

  const navigationSeq = useRef(0);
  useEffect(() => () => { navigationSeq.current += 1; }, []);

  const [rooms, setRooms] = useState([]);
  const [roomsState, setRoomsState] = useState("loading");
  // Ignore fetches that started before a local room creation or socket change.
  const mutationSeq = useRef(0);

  const loadRooms = useCallback(async () => {
    const seq = mutationSeq.current;

    try {
      const data = await getRooms();
      if (seq !== mutationSeq.current) return;
      setRooms(data);
      setRoomsState("success");
    } catch {
      // A failed refresh keeps the rooms already on screen; only a first load with
      // nothing to show is an error the sidebar should report.
      setRoomsState((state) => (state === "loading" ? "error" : state));
    }
  }, []);

  // Load once in the shell; socket events keep the list current in every view.
  useEffect(() => {
    mutationSeq.current += 1;
    loadRooms();
  }, [loadRooms]);

  // Added to a room, removed or kicked from one, a room renamed, or the socket
  // reconnected after possibly missing some of those. The event says only
  // which room, so refetch: GET /rooms applies org's own rules. Bumping the
  // sequence first discards a request already in flight, which may have been
  // answered before the change and would otherwise land after this fetch.
  // Removal from the open room is then handled by the effect further down.
  useEffect(
    () =>
      onRoomEvent((event) => {
        if (event.type === "activity") return; // previews: the group list shows none
        mutationSeq.current += 1;
        loadRooms();
      }),
    [loadRooms],
  );

  const addRoom = useCallback((room) => {
    // Bump before inserting, so a request issued before the room existed is
    // discarded rather than removing it again.
    mutationSeq.current += 1;
    setRooms((previous) => [room, ...previous]);
    setRoomsState("success");
  }, []);

  const updateRoom = useCallback((room) => {
    mutationSeq.current += 1;
    setRooms((previous) => previous.map((current) => current.id === room.id ? room : current));
  }, []);

  const removeRoom = useCallback((roomId) => {
    mutationSeq.current += 1;
    setRooms((previous) => previous.filter((room) => room.id !== roomId));
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
    navigationSeq.current += 1;
    setActiveRoomId(roomId);
    setIsDirectMessages(false);
    setIsNavOpen(false);
  }, []);

  const handleDirectMessages = useCallback(() => {
    navigationSeq.current += 1;
    setIsDirectMessages(true);
    setIsNavOpen(false);
  }, []);

  const navigateNotification = async (destination) => {
    const seq = ++navigationSeq.current;
    try {
      if (destination.type === "profile") {
        closeUserPreview();
        setIsNavOpen(false);
        await openProfile({ tab: destination.tab });
      } else if (destination.type === "room") {
        const room = await getRoom(destination.roomId);
        if (seq !== navigationSeq.current) return;
        if (room.type === "group") {
          // A new-room notification can be clicked before the room-list refresh finishes.
          mutationSeq.current += 1;
          setRooms((previous) => [room, ...previous.filter((item) => item.id !== room.id)]);
          setRoomsState("success");
          loadRooms();
        }
        closeProfile();
        closeUserPreview();
        handleRoomChange(room);
      } else if (destination.type === "conversations") {
        closeProfile();
        closeUserPreview();
        handleDirectMessages();
      }
    } catch (error) {
      if (seq === navigationSeq.current) toast.error(error?.message || "Couldn't open this notification.");
    }
  };

  useSocketNotifications(currentUser?.id, isDirectMessages ? null : activeRoomId?.id, navigateNotification, rooms);

  // A first send may finish after navigation. Replace only its own draft and
  // keep whichever view the user has since chosen.
  const handleRoomInitialized = useCallback((draftId, room) => {
    setActiveRoomId((current) =>
      current?.isDraft && current.id === draftId ? room : current,
    );
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

  // Use the current group metadata so local edits and socket refreshes update
  // the open header without remounting its messages or losing the draft.
  const activeRoom = activeRoomId?.type === "group"
    ? rooms.find((room) => room.id === activeRoomId.id) ?? activeRoomId
    : activeRoomId;

  return (
    <NavDrawerProvider value={navDrawer}>
      <RoomNavigationProvider navigateToRoom={handleRoomChange}>
        <AppShellRoot ref={viewportRef}>
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
              onRoomUpdated={updateRoom}
              onRoomLeft={removeRoom}
              onRoomChange={handleRoomChange}
              onDirectMessages={handleDirectMessages}
              onLogout={onLogout}
            />
          </SlidePanel>

          <MainContent>
            <MainPanel
              activeView={isDirectMessages ? true : activeRoom}
              onRoomInitialized={handleRoomInitialized}
            />
          </MainContent>
        </AppShellRoot>

        {profile && (
          <ProfileOverlay
            key={profileNavigation.id}
            user={profile}
            initialTab={profileNavigation.tab}
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
