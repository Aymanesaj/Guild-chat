import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import {
  TbCheck,
  TbDoorExit,
  TbPencil,
  TbSend,
  TbUserMinus,
  TbX,
} from "react-icons/tb";

import { useProfileOverlay } from "./ProfileOverlayContext";
import { useRoomNavigation } from "./RoomNavigationContext";
import { useAvatarUrl } from "../../hooks/useAvatarUrl";
import UserAvatar from "../profile/UserAvatar";
import FriendRequestForm from "../profile/FriendRequestForm";

import {
  checkUsernameAvailability,
  forgetAvatar,
  updateProfile,
  uploadAvatar,
} from "../../api/profile";

import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendRequests,
  getFriendsList,
  getSentFriendRequests,
  removeFriend,
} from "../../api/friends";

import { getOrCreateDm, getRooms, leaveRoom } from "../../api/rooms";

import {
  Button as KitButton,
  ConfirmDialog,
  IconButton as KitIconButton,
  Input as KitInput,
  Tab,
  TabList,
  TextArea as KitTextArea,
  fadeIn,
  riseIn,
} from "../ui";


const CONFIRM_TITLES = {
  "remove-friend": "Remove friend?",
  "decline-friend-request": "Decline request?",
  "leave-room": "Leave room?",
  "cancel-friend-request": "Cancel request?",
};

const CONFIRM_TEXTS = {
  "remove-friend": (label) => `Remove @${label} from your friends?`,
  "decline-friend-request": (label) => `Decline the request from @${label}?`,
  "leave-room": (label) => `Leave ${label}?`,
  "cancel-friend-request": (label) =>
    `Cancel your friend request to @${label}?`,
};

const DEBOUNCE_MS = 400;
const MANAGEMENT_PAGE_SIZE = 50;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;


// -----------------------------------------------------------------------------
// Username availability
// -----------------------------------------------------------------------------

function useUsernameAvailability(username, currentUsername) {
  const [status, setStatus] = useState("idle");
  const controllerRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    clearTimeout(timerRef.current);
    controllerRef.current?.abort();

    if (!username || username === currentUsername) {
      setStatus("idle");
      return;
    }

    if (!USERNAME_RE.test(username)) {
      setStatus("invalid");
      return;
    }

    setStatus("checking");

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const { available } = await checkUsernameAvailability(username, {
          signal: controller.signal,
        });

        setStatus(available ? "available" : "taken");
      } catch (err) {
        if (err.name !== "AbortError") {
          setStatus("error");
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timerRef.current);
      controllerRef.current?.abort();
    };
  }, [username, currentUsername]);

  return status;
}


// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export default function ProfileOverlay({ user, onClose }) {
  const {
    refreshProfile,
    loadingProfile,
    notifyRoomsChanged,
  } = useProfileOverlay();

  const { navigateToRoom } = useRoomNavigation();

  const { avatarUrl, loading: avatarLoading } = useAvatarUrl(
    user.avatar_file
  );

  const avatarInputRef = useRef(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const handleAvatarButtonClick = () => {
    if (avatarUploading) {
      return;
    }

    avatarInputRef.current?.click();
  };

  const handleAvatarFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setAvatarUploading(true);
    setAvatarError("");

    try {
      // Drop the cached object URL first: identity can hand back the same
      // path with new bytes, and the cache would otherwise serve the old one.
      forgetAvatar(user.avatar_file);
      await uploadAvatar(file);
      await refreshProfile();
    } catch (error) {
      setAvatarError(
        error?.message || "Failed to upload avatar."
      );
    } finally {
      setAvatarUploading(false);
    }
  };


  // ---------------------------------------------------------------------------
  // Section state
  // ---------------------------------------------------------------------------

  // Friends | Rooms, and the sub-tab under it (friends/requests/sent | rooms).
  const [managementSection, setManagementSection] =
    useState("friends");

  const [managementTab, setManagementTab] =
    useState("friends");


  // ---------------------------------------------------------------------------
  // Profile editing
  // ---------------------------------------------------------------------------

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [draft, setDraft] = useState({
    displayName: user.displayName ?? "",
    username: user.username ?? "",
    bio: user.bio ?? "",
  });

  const usernameStatus = useUsernameAvailability(
    draft.username,
    user.username
  );

  const canSave =
    !saving &&
    draft.displayName.trim().length > 0 &&
    usernameStatus !== "checking" &&
    usernameStatus !== "taken" &&
    usernameStatus !== "invalid" &&
    usernameStatus !== "error";


  // ---------------------------------------------------------------------------
  // Friends / rooms data
  // ---------------------------------------------------------------------------

  const [friends, setFriends] = useState([]);
  const [friendsOffset, setFriendsOffset] = useState(0);
  const [friendsHasMore, setFriendsHasMore] = useState(false);

  const [friendRequests, setFriendRequests] = useState([]);
  const [requestsOffset, setRequestsOffset] = useState(0);
  const [requestsHasMore, setRequestsHasMore] = useState(false);

  const [rooms, setRooms] = useState([]);
  const [roomsOffset, setRoomsOffset] = useState(0);
  const [roomsHasMore, setRoomsHasMore] = useState(false);

  const [sentRequests, setSentRequests] = useState([]);
  const [sentOffset, setSentOffset] = useState(0);
  const [sentHasMore, setSentHasMore] = useState(false);

  const [loadingSection, setLoadingSection] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sectionError, setSectionError] = useState("");

  // The friend whose DM is being opened, so only that row's button is busy.
  const [openingDmId, setOpeningDmId] = useState(null);

  // Confirmation
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmError, setConfirmError] = useState("");
  const [runningAction, setRunningAction] = useState(false);


  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  // Each section opens on its first sub-tab, which shares the section's name.
  const selectSection = (section) => {
    setSectionError("");
    setManagementSection(section);
    setManagementTab(section);
  };


  // ---------------------------------------------------------------------------
  // Profile editing
  // ---------------------------------------------------------------------------

  const startEditing = () => {
    setDraft({
      displayName: user.displayName ?? "",
      username: user.username ?? "",
      bio: user.bio ?? "",
    });

    setSaveError("");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setSaveError("");
    setIsEditing(false);
  };

  const saveEditing = async () => {
    if (!canSave) {
      return;
    }

    setSaving(true);
    setSaveError("");

    try {
      await updateProfile({
        display_name: draft.displayName,
        username: draft.username,
        bio: draft.bio,
      });

      await refreshProfile();

      setIsEditing(false);
    } catch (error) {
      setSaveError(error?.message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };


  // ---------------------------------------------------------------------------
  // Data loading (paginated, MANAGEMENT_PAGE_SIZE at a time)
  // ---------------------------------------------------------------------------

  const loadFriendsPage = async (reset = false) => {
    const nextOffset = reset ? 0 : friendsOffset;

    reset ? setLoadingSection(true) : setLoadingMore(true);
    setSectionError("");

    try {
      const data = await getFriendsList({
        limit: MANAGEMENT_PAGE_SIZE,
        offset: nextOffset,
      });

      const batch = Array.isArray(data) ? data : [];

      setFriends((prev) => (reset ? batch : [...prev, ...batch]));
      setFriendsOffset(nextOffset + batch.length);
      setFriendsHasMore(batch.length === MANAGEMENT_PAGE_SIZE);
    } catch (error) {
      setSectionError(
        error?.message || "Failed to load friends."
      );
    } finally {
      reset ? setLoadingSection(false) : setLoadingMore(false);
    }
  };

  const loadRequestsPage = async (reset = false) => {
    const nextOffset = reset ? 0 : requestsOffset;

    reset ? setLoadingSection(true) : setLoadingMore(true);
    setSectionError("");

    try {
      const data = await getFriendRequests({
        limit: MANAGEMENT_PAGE_SIZE,
        offset: nextOffset,
      });

      const batch = Array.isArray(data) ? data : [];

      setFriendRequests((prev) =>
        reset ? batch : [...prev, ...batch]
      );
      setRequestsOffset(nextOffset + batch.length);
      setRequestsHasMore(batch.length === MANAGEMENT_PAGE_SIZE);
    } catch (error) {
      setSectionError(
        error?.message || "Failed to load requests."
      );
    } finally {
      reset ? setLoadingSection(false) : setLoadingMore(false);
    }
  };

  const loadRoomsPage = async (reset = false) => {
    const nextOffset = reset ? 0 : roomsOffset;

    reset ? setLoadingSection(true) : setLoadingMore(true);
    setSectionError("");

    try {
      const data = await getRooms({
        limit: MANAGEMENT_PAGE_SIZE,
        offset: nextOffset,
      });

      const batch = Array.isArray(data) ? data : [];

      setRooms((prev) => (reset ? batch : [...prev, ...batch]));
      setRoomsOffset(nextOffset + batch.length);
      setRoomsHasMore(batch.length === MANAGEMENT_PAGE_SIZE);
    } catch (error) {
      setSectionError(
        error?.message || "Failed to load rooms."
      );
    } finally {
      reset ? setLoadingSection(false) : setLoadingMore(false);
    }
  };

  const loadSentPage = async (reset = false) => {
    const nextOffset = reset ? 0 : sentOffset;

    reset ? setLoadingSection(true) : setLoadingMore(true);
    setSectionError("");

    try {
      const data = await getSentFriendRequests({
        limit: MANAGEMENT_PAGE_SIZE,
        offset: nextOffset,
      });

      const batch = Array.isArray(data) ? data : [];

      setSentRequests((prev) =>
        reset ? batch : [...prev, ...batch]
      );
      setSentOffset(nextOffset + batch.length);
      setSentHasMore(batch.length === MANAGEMENT_PAGE_SIZE);
    } catch (error) {
      setSectionError(
        error?.message || "Failed to load sent requests."
      );
    } finally {
      reset ? setLoadingSection(false) : setLoadingMore(false);
    }
  };


  // Whichever sub-tab is active loads from page 1.

  useEffect(() => {
    if (managementSection === "friends") {
      if (managementTab === "friends") {
        loadFriendsPage(true);
      } else if (managementTab === "requests") {
        loadRequestsPage(true);
      } else if (managementTab === "sent") {
        loadSentPage(true);
      }
    } else {
      loadRoomsPage(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managementSection, managementTab, user.id]);


  // ---------------------------------------------------------------------------
  // Confirmation actions
  // ---------------------------------------------------------------------------

  const requestRemoveFriend = (friend) => {
    setConfirmError("");

    setConfirmAction({
      type: "remove-friend",
      id: friend.id,
      label: friend.username,
    });
  };


  const requestDeclineFriendRequest = (request) => {
    setConfirmError("");

    setConfirmAction({
      type: "decline-friend-request",
      id: request.friendship_id,
      label: request.sender?.username || "this request",
    });
  };


  const requestLeaveRoom = (room) => {
    setConfirmError("");

    setConfirmAction({
      type: "leave-room",
      id: room.id,
      label: room.name || "Direct message",
    });
  };


  const requestCancelSentRequest = (request) => {
    setConfirmError("");

    setConfirmAction({
      type: "cancel-friend-request",
      id: request.receiver?.id,
      label: request.receiver?.username || "this user",
    });
  };


  const cancelConfirmAction = () => {
    if (runningAction) {
      return;
    }

    setConfirmError("");
    setConfirmAction(null);
  };


  const reloadActiveManagementTab = async () => {
    if (managementSection === "friends") {
      if (managementTab === "friends") {
        await loadFriendsPage(true);
      } else if (managementTab === "requests") {
        await loadRequestsPage(true);
      } else if (managementTab === "sent") {
        await loadSentPage(true);
      }
    } else {
      await loadRoomsPage(true);
    }
  };


  const applyAction = async () => {
    if (!confirmAction) {
      return;
    }

    setRunningAction(true);
    setConfirmError("");

    try {
      if (confirmAction.type === "remove-friend") {
        await removeFriend(confirmAction.id);
      }

      if (confirmAction.type === "decline-friend-request") {
        await declineFriendRequest(confirmAction.id);
      }

      if (confirmAction.type === "leave-room") {
        await leaveRoom(confirmAction.id);
        notifyRoomsChanged();
      }

      if (confirmAction.type === "cancel-friend-request") {
        await cancelFriendRequest(confirmAction.id);
      }

      await refreshProfile();
      await reloadActiveManagementTab();

      setConfirmAction(null);
    } catch (error) {
      setConfirmError(
        error?.message || "Failed to apply action."
      );
    } finally {
      setRunningAction(false);
    }
  };


  // ---------------------------------------------------------------------------
  // Direct messages
  // ---------------------------------------------------------------------------

  /* Opening the room is enough — the composer is waiting there, so nothing is
     sent from here. DMs stay friends-only because this is a friends list. */
  const handleOpenDm = async (friend) => {
    if (openingDmId) return;

    setOpeningDmId(friend.id);
    setSectionError("");

    try {
      const room = await getOrCreateDm(friend.id);

      navigateToRoom(room);
      onClose();
    } catch (error) {
      setSectionError(
        error?.message || `Couldn't open a chat with ${friend.username}.`
      );
    } finally {
      setOpeningDmId(null);
    }
  };


  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  const renderFriendRows = (items) => {
    return (
      <>
        {items.length > 0 ? (
          items.map((friend) => (
            <ListRow key={friend.id}>
              <RowAvatar avatar={friend.avatar} name={friend.username} />

              <RowName>
                {friend.username}
              </RowName>

              <RowActions>
                <ActionButton
                  type="button"
                  onClick={() => handleOpenDm(friend)}
                  disabled={openingDmId === friend.id}
                  aria-label={`Message ${friend.username}`}
                  title={`Message ${friend.username}`}
                >
                  <TbSend size={16} />
                </ActionButton>

                <ActionButton
                  type="button"
                  onClick={() =>
                    requestRemoveFriend(friend)
                  }
                  aria-label={`Remove ${friend.username}`}
                >
                  <TbUserMinus size={16} />
                </ActionButton>
              </RowActions>
            </ListRow>
          ))
        ) : (
          <EmptyState>
            No friends yet
          </EmptyState>
        )}
      </>
    );
  };


  const renderRoomRows = (items) => {
    return (
      <>
        {items.length > 0 ? (
          items.map((room) => (
            <ListRow key={room.id}>
              {/* A DM shows the peer; a group room has no image, so the initial stands. */}
              <RowAvatar
                avatar={room.peer?.avatar}
                name={room.name || room.peer?.username || "DM"}
              />

              <RowName>
                {room.name || room.peer?.username || "Direct message"}
              </RowName>

              <ActionButton
                type="button"
                onClick={() =>
                  requestLeaveRoom(room)
                }
                aria-label={`Leave ${
                  room.name || "direct message"
                }`}
              >
                <TbDoorExit size={16} />
              </ActionButton>
            </ListRow>
          ))
        ) : (
          <EmptyState>
            No rooms yet
          </EmptyState>
        )}
      </>
    );
  };


  // ---------------------------------------------------------------------------
  // Management content
  // ---------------------------------------------------------------------------

  const renderFriendsManagement = () => {
    if (managementTab === "friends") {
      return (
        <ExpandedListPanel>
          {renderFriendRows(friends)}

          {friendsHasMore && (
            <CenteredButtonWrap>
              <PillButton
                type="button"
                onClick={() => loadFriendsPage(false)}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </PillButton>
            </CenteredButtonWrap>
          )}
        </ExpandedListPanel>
      );
    }

    if (managementTab === "requests") {
      return (
        <ExpandedListPanel>
          {friendRequests.length > 0 ? (
            friendRequests.map((request) => (
              <RequestRow key={request.friendship_id}>
                <RowAvatar
                  avatar={request.sender?.avatar}
                  name={request.sender?.username}
                />

                <RowName>
                  {request.sender?.username}
                </RowName>

                <RowActions>
                  <ActionButton
                    type="button"
                    onClick={async () => {
                      try {
                        await acceptFriendRequest(
                          request.friendship_id
                        );

                        await Promise.all([
                          refreshProfile(),
                          loadRequestsPage(true),
                        ]);
                      } catch (error) {
                        setSectionError(
                          error?.message ||
                            "Failed to accept request."
                        );
                      }
                    }}
                    aria-label={`Accept ${
                      request.sender?.username
                    }`}
                  >
                    <TbCheck size={16} />
                  </ActionButton>

                  <ActionButton
                    type="button"
                    onClick={() =>
                      requestDeclineFriendRequest(
                        request
                      )
                    }
                    aria-label={`Decline ${
                      request.sender?.username
                    }`}
                  >
                    <TbX size={16} />
                  </ActionButton>
                </RowActions>
              </RequestRow>
            ))
          ) : (
            <EmptyState>
              No pending requests
            </EmptyState>
          )}

          {requestsHasMore && (
            <CenteredButtonWrap>
              <PillButton
                type="button"
                onClick={() => loadRequestsPage(false)}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </PillButton>
            </CenteredButtonWrap>
          )}
        </ExpandedListPanel>
      );
    }

    return (
      <ExpandedListPanel>
        {sentRequests.length > 0 ? (
          sentRequests.map((request) => (
            <RequestRow key={request.friendship_id}>
              <RowAvatar
                avatar={request.receiver?.avatar}
                name={request.receiver?.username}
              />

              <RowName>
                {request.receiver?.username}
              </RowName>

              <RowActions>
                <ActionButton
                  type="button"
                  onClick={() =>
                    requestCancelSentRequest(request)
                  }
                  aria-label={`Cancel request to ${
                    request.receiver?.username
                  }`}
                >
                  <TbX size={16} />
                </ActionButton>
              </RowActions>
            </RequestRow>
          ))
        ) : (
          <EmptyState>
            No sent requests
          </EmptyState>
        )}

        {sentHasMore && (
          <CenteredButtonWrap>
            <PillButton
              type="button"
              onClick={() => loadSentPage(false)}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading..." : "Load more"}
            </PillButton>
          </CenteredButtonWrap>
        )}
      </ExpandedListPanel>
    );
  };


  const renderRoomsManagement = () => {
    return (
      <ExpandedListPanel>
        {renderRoomRows(rooms)}

        {roomsHasMore && (
          <CenteredButtonWrap>
            <PillButton
              type="button"
              onClick={() => loadRoomsPage(false)}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading..." : "Load more"}
            </PillButton>
          </CenteredButtonWrap>
        )}
      </ExpandedListPanel>
    );
  };


  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <Overlay onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Banner />

        <CloseButton
          onClick={onClose}
          aria-label="Close"
        >
          <TbX size={20} />
        </CloseButton>

        <AvatarWrap>
          <AvatarButton
            type="button"
            onClick={handleAvatarButtonClick}
            disabled={avatarUploading}
            aria-label="Update avatar"
          >
            {avatarLoading ? null : avatarUrl ? (
              <AvatarImage src={avatarUrl} alt="" />
            ) : (
              <AvatarFallback>
                {user.displayName
                  ?.charAt(0)
                  ?.toUpperCase() || "?"}
              </AvatarFallback>
            )}

            <AvatarOverlay>
              {avatarUploading
                ? "Uploading..."
                : "Update avatar"}
            </AvatarOverlay>
          </AvatarButton>

          <HiddenFileInput
            ref={avatarInputRef}
            id="avatar-upload"
            name="avatar"
            type="file"
            accept="image/*"
            onChange={handleAvatarFileChange}
          />

          {avatarError && (
            <AvatarErrorText>
              {avatarError}
            </AvatarErrorText>
          )}
        </AvatarWrap>

        <Content>
              {/* ------------------------------------------------------------- */}
              {/* PROFILE VIEW                                                   */}
              {/* ------------------------------------------------------------- */}

              {loadingProfile && (
                <LoadingHint>
                  Refreshing profile...
                </LoadingHint>
              )}

              <HeaderRow>
                <NameBlock>
                  {isEditing ? (
                    <>
                      <NameInput
                        value={draft.displayName}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            displayName:
                              e.target.value,
                          }))
                        }
                        placeholder="Display name"
                      />

                      <HandleInput
                        value={draft.username}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            username:
                              e.target.value,
                          }))
                        }
                        placeholder="username"
                        $status={usernameStatus}
                      />

                      {usernameStatus ===
                        "checking" && (
                        <HelperText>
                          Checking availability…
                        </HelperText>
                      )}

                      {usernameStatus ===
                        "taken" && (
                        <HelperText $error>
                          Username taken
                        </HelperText>
                      )}

                      {usernameStatus ===
                        "invalid" && (
                        <HelperText $error>
                          3–20 chars,
                          letters/numbers/underscore
                        </HelperText>
                      )}

                      {usernameStatus ===
                        "available" && (
                        <HelperText $ok>
                          Available
                        </HelperText>
                      )}
                    </>
                  ) : (
                    <>
                      <Username>
                        {user.displayName}
                      </Username>

                      {user.username && (
                        <Handle>
                          @{user.username}
                        </Handle>
                      )}
                    </>
                  )}
                </NameBlock>

                {isEditing ? (
                  <EditActions>
                    <IconButton
                      onClick={saveEditing}
                      aria-label="Save"
                      disabled={!canSave}
                    >
                      <TbCheck size={18} />
                    </IconButton>

                    <IconButton
                      onClick={cancelEditing}
                      aria-label="Cancel"
                    >
                      <TbX size={18} />
                    </IconButton>
                  </EditActions>
                ) : (
                  <IconButton
                    onClick={startEditing}
                    aria-label="Edit profile"
                  >
                    <TbPencil size={18} />
                  </IconButton>
                )}
              </HeaderRow>

              {isEditing && saveError && (
                <HelperText $error>{saveError}</HelperText>
              )}

              <Divider />

              {isEditing ? (
                <BioInput
                  value={draft.bio}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      bio: e.target.value,
                    }))
                  }
                  placeholder="Write something about yourself..."
                  rows={3}
                />
              ) : (
                <Bio>
                  {user.bio}
                </Bio>
              )}

              {/* ------------------------------------------------------------- */}
              {/* FRIENDS / ROOMS                                                */}
              {/* ------------------------------------------------------------- */}

              <SectionPanel>
                <SectionTabs>
                  <SectionTab
                    type="button"
                    $active={managementSection === "friends"}
                    onClick={() => selectSection("friends")}
                  >
                    Friends
                  </SectionTab>

                  <SectionTab
                    type="button"
                    $active={managementSection === "rooms"}
                    onClick={() => selectSection("rooms")}
                  >
                    Rooms
                  </SectionTab>
                </SectionTabs>

                {/* Rooms has a single list, so only friends gets sub-tabs. */}
                {managementSection === "friends" && (
                  <SubTabs>
                    <SubTab
                      type="button"
                      $active={managementTab === "friends"}
                      onClick={() => setManagementTab("friends")}
                    >
                      Friends
                    </SubTab>

                    <SubTab
                      type="button"
                      $active={managementTab === "requests"}
                      onClick={() => setManagementTab("requests")}
                    >
                      Incoming
                    </SubTab>

                    <SubTab
                      type="button"
                      $active={managementTab === "sent"}
                      onClick={() => setManagementTab("sent")}
                    >
                      Sent
                    </SubTab>

                    <FriendInvite
                      onSent={() => setManagementTab("sent")}
                      onError={setSectionError}
                    />
                  </SubTabs>
                )}

                {sectionError && (
                  <InlineError>
                    {sectionError}
                  </InlineError>
                )}

                <ManagementContent>
                  {loadingSection ? (
                    <EmptyState>
                      Loading...
                    </EmptyState>
                  ) : managementSection === "friends" ? (
                    renderFriendsManagement()
                  ) : (
                    renderRoomsManagement()
                  )}
                </ManagementContent>
              </SectionPanel>
        </Content>

        {/* ----------------------------------------------------------------- */}
        {/* CONFIRMATION                                                       */}
        {/* ----------------------------------------------------------------- */}

        <ConfirmDialog
          open={Boolean(confirmAction)}
          position="absolute"
          title={confirmAction ? CONFIRM_TITLES[confirmAction.type] : ""}
          text={
            confirmAction
              ? CONFIRM_TEXTS[confirmAction.type]?.(confirmAction.label)
              : ""
          }
          error={confirmError}
          busy={runningAction}
          onConfirm={applyAction}
          onCancel={cancelConfirmAction}
        />
      </Card>
    </Overlay>
  );
}


// =============================================================================
// Styles
// =============================================================================

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  overflow-y: auto;
  padding: 4vh 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  animation: ${fadeIn} var(--dur) var(--ease);
  z-index: var(--z-overlay);
`;

const Card = styled.div`
  position: relative;
  width: 640px;
  max-width: 90vw;
  height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  box-shadow: var(--shadow-lg);
  animation: ${riseIn} var(--dur) var(--ease);
`;

const Banner = styled.div`
  flex-shrink: 0;
  height: 160px;
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(
    135deg,
    var(--accent-600),
    color-mix(in srgb, var(--accent-600) 30%, var(--bg-base))
  );
`;

const CloseButton = styled(KitIconButton).attrs({ $size: 36 })`
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  border-color: var(--border-strong);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;

  &:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
  }
`;

// =============================================================================
// Avatar — straddles the banner/content seam, centered horizontally,
// dims and shows an "Update avatar" overlay on hover.
// =============================================================================

const AvatarWrap = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: -64px;
  z-index: 1;
`;

const AvatarOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 0 10px;
  text-align: center;
  font-size: var(--text-xs);
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
`;

const AvatarButton = styled.button`
  position: relative;
  width: 128px;
  height: 128px;
  padding: 0;
  overflow: hidden;
  border: 5px solid var(--bg-elevated);
  border-radius: 50%;
  background: var(--accent-600);

  &:hover:not(:disabled) ${AvatarOverlay} {
    opacity: 1;
  }

  &:disabled {
    cursor: not-allowed;
  }
`;

const AvatarImage = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const AvatarFallback = styled.span`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 2.25rem;
  font-weight: 700;
  color: var(--accent-fg);
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const AvatarErrorText = styled.span`
  font-size: var(--text-xs);
  color: var(--danger);
`;

const Content = styled.div`
  flex: 1;
  min-height: 0;
  padding: 0 var(--space-6) var(--space-6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const LoadingHint = styled.p`
  margin: var(--space-3) 0 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
`;

const HeaderRow = styled.div`
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-4);
  gap: var(--space-4);
`;

const NameBlock = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
`;

const Username = styled.h2`
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Handle = styled.span`
  display: block;
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
`;

const NameInput = styled(KitInput)`
  font-size: 1.15rem;
  font-weight: 600;
`;

const HandleInput = styled(KitInput)`
  font-size: var(--text-sm);

  border-color: ${({ $status }) =>
    $status === "taken" || $status === "invalid" || $status === "error"
      ? "var(--danger)"
      : $status === "available"
      ? "var(--success)"
      : "var(--border-strong)"};
`;

const HelperText = styled.span`
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: ${({ $error, $ok }) =>
    $error ? "var(--danger)" : $ok ? "var(--success)" : "var(--text-tertiary)"};
`;

const BioInput = styled(KitTextArea)`
  margin-top: var(--space-5);
`;

const EditActions = styled.div`
  flex-shrink: 0;
  display: flex;
  gap: var(--space-2);
`;

const IconButton = styled(KitIconButton).attrs({ $size: 40 })`
  border-color: var(--border-strong);
  border-radius: 50%;

  &:active:not(:disabled) {
    transform: scale(0.97);
  }
`;

const Divider = styled.div`
  flex-shrink: 0;
  margin-top: var(--space-5);
  border-top: 1px solid var(--border-subtle);
`;

const Bio = styled.p`
  flex-shrink: 0;
  margin: 0;
  padding-top: var(--space-5);
  line-height: 1.5;
  color: var(--text-secondary);
`;

// =============================================================================
// Friends / Rooms — section tabs, then (friends only) a row of sub-tab chips,
// then the list itself (the only part that scrolls).
// =============================================================================

const SectionPanel = styled.div`
  flex: 1;
  min-height: 0;
  margin-top: var(--space-5);
  display: flex;
  flex-direction: column;
`;

const SectionTabs = styled(TabList)`
  flex-shrink: 0;
  justify-content: flex-start;
  gap: var(--space-5);
  margin-bottom: var(--space-3);
`;

const SectionTab = Tab;

const SubTabs = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  /* The chips and the request box together are wider than the card gets on a
     phone, so let the box drop to a line of its own. */
  flex-wrap: wrap;
`;

const SubTab = styled.button`
  padding: 4px 12px;
  border: 1px solid
    ${({ $active }) => ($active ? "var(--accent-500)" : "var(--border-strong)")};
  border-radius: var(--radius-pill);
  background: ${({ $active }) => ($active ? "var(--accent-ring)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--text-primary)" : "var(--text-secondary)")};
  font-size: var(--text-sm);
  font-weight: ${({ $active }) => ($active ? 600 : 500)};
  transition:
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);

  &:hover {
    color: var(--text-primary);
  }
`;

const ManagementContent = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const InlineError = styled.div`
  flex-shrink: 0;
  margin-bottom: var(--space-3);
  color: var(--danger);
  font-size: var(--text-sm);
`;

const ExpandedListPanel = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

// =============================================================================
// Lists
// =============================================================================

const ListRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--space-2) var(--space-1);
  border-radius: var(--radius-md);
  transition: background var(--dur-fast) var(--ease);

  &:hover {
    background: var(--bg-hover);
  }
`;

/* Resolves its own image; falls back to the initial when there is no avatar. */
const RowAvatar = styled(UserAvatar)`
  background: var(--accent-600);
`;

const RowName = styled.span`
  flex: 1;
  min-width: 0;
  font-size: var(--text-md);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ActionButton = styled(KitIconButton).attrs({ $size: 30 })`
  border-color: var(--border-strong);
`;

const RequestRow = styled(ListRow)`
  justify-content: space-between;
`;

const RowActions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-1);
`;

const EmptyState = styled.div`
  flex-shrink: 0;
  padding: var(--space-5) var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
`;

// =============================================================================
// Add friend
// =============================================================================

/* Add-a-friend box, at the far right of the friends sub-tabs row. */
const FriendInvite = styled(FriendRequestForm)`
  /* Once wrapped, it owns the line — so it spans it instead of sitting in the
     middle where "margin-left: auto" would leave it. */
  @media (max-width: 700px) {
    width: 100%;
    margin-left: 0;
  }
`;

// =============================================================================
// See all / Load more
// =============================================================================

const CenteredButtonWrap = styled.div`
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: var(--space-3) 0 var(--space-1);
`;

const PillButton = styled(KitButton).attrs({ $variant: "secondary", $pill: true, $size: "sm" })``;
