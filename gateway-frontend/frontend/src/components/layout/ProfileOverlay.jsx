import { useEffect, useId, useRef, useState } from "react";
import styled from "styled-components";
import { useToast } from "../ui/ToastProvider";
import {
  TbCheck,
  TbPencil,
  TbSend,
  TbUserMinus,
  TbX,
} from "react-icons/tb";

import { useProfileOverlay } from "./ProfileOverlayContext";
import { useRoomNavigation } from "./RoomNavigationContext";
import { useAvatarUrl } from "../../hooks/useAvatarUrl";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { PHONE_QUERY } from "../../constants/breakpoints";
import UserAvatar from "../profile/UserAvatar";
import FriendRequestForm from "../profile/FriendRequestForm";
import MessageByteCount from "../ui/MessageByteCount";
import { limitMessageInput, messageByteLength } from "../../utils/messageContent";

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

import { openDm } from "../../api/rooms";

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
  "cancel-friend-request": "Cancel request?",
};

const CONFIRM_TEXTS = {
  "remove-friend": (label) => `Remove @${label} from your friends?`,
  "decline-friend-request": (label) => `Decline the request from @${label}?`,
  "cancel-friend-request": (label) =>
    `Cancel your friend request to @${label}?`,
};

const DEBOUNCE_MS = 400;
const MANAGEMENT_PAGE_SIZE = 50;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MAX_DISPLAY_NAME_BYTES = 80;
const MAX_BIO_BYTES = 280;
const MAX_BIO_INPUT_BYTES = 500;


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

        if (!controller.signal.aborted) {
          setStatus(available ? "available" : "taken");
        }
      } catch (err) {
        if (!controller.signal.aborted && err.name !== "AbortError") {
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

export default function ProfileOverlay({ user, onClose, initialTab = "friends" }) {
  const toast = useToast();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const {
    refreshProfile,
    loadingProfile,
  } = useProfileOverlay();

  const { navigateToRoom } = useRoomNavigation();

  const { avatarUrl, loading: avatarLoading } = useAvatarUrl(
    user.avatar_file
  );

  const avatarInputRef = useRef(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

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

    try {
      // Drop the cached object URL first: identity can hand back the same
      // path with new bytes, and the cache would otherwise serve the old one.
      forgetAvatar(user.avatar_file);
      await uploadAvatar(file);
      await refreshProfile();
      toast.success("Avatar updated.");
    } catch (error) {
      toast.error(
        error?.message || "Failed to upload avatar."
      );
    } finally {
      setAvatarUploading(false);
    }
  };


  // ---------------------------------------------------------------------------
  // Section state
  // ---------------------------------------------------------------------------

  // Main section and friends sub-tabs.
  const [managementSection, setManagementSection] = useState("friends");
  const [managementTab, setManagementTab] =
    useState(initialTab);


  // ---------------------------------------------------------------------------
  // Profile editing
  // ---------------------------------------------------------------------------

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [draft, setDraft] = useState({
    displayName: user.displayName ?? "",
    username: user.username ?? "",
    bio: user.bio ?? "",
  });

  const nextUsername = draft.username.trim();
  const checkedUsernameStatus = useUsernameAvailability(
    nextUsername,
    user.username
  );
  const usernameStatus = nextUsername ? checkedUsernameStatus : "idle";

  const displayNameCountId = useId();
  const displayNameBytes = messageByteLength(draft.displayName);
  const displayNameOverLimit = displayNameBytes > MAX_DISPLAY_NAME_BYTES;
  const bioCountId = useId();
  const bioBytes = messageByteLength(draft.bio);
  const bioOverLimit = bioBytes > MAX_BIO_BYTES;

  const canSave =
    !saving &&
    !displayNameOverLimit &&
    !bioOverLimit &&
    draft.displayName.trim().length > 0 &&
    nextUsername.length > 0 &&
    usernameStatus !== "checking" &&
    usernameStatus !== "taken" &&
    usernameStatus !== "invalid" &&
    usernameStatus !== "error";


  // ---------------------------------------------------------------------------
  // Friends data
  // ---------------------------------------------------------------------------

  const [friends, setFriends] = useState([]);
  const [friendsOffset, setFriendsOffset] = useState(0);
  const [friendsHasMore, setFriendsHasMore] = useState(false);

  const [friendRequests, setFriendRequests] = useState([]);
  const [requestsOffset, setRequestsOffset] = useState(0);
  const [requestsHasMore, setRequestsHasMore] = useState(false);

  const [sentRequests, setSentRequests] = useState([]);
  const [sentOffset, setSentOffset] = useState(0);
  const [sentHasMore, setSentHasMore] = useState(false);

  const [loadingSection, setLoadingSection] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // The friend whose DM is being opened, so only that row's button is busy.
  const [openingDmId, setOpeningDmId] = useState(null);

  // Confirmation
  const [confirmAction, setConfirmAction] = useState(null);
  const [runningAction, setRunningAction] = useState(false);


  // ---------------------------------------------------------------------------
  // Profile editing
  // ---------------------------------------------------------------------------

  const startEditing = () => {
    setDraft({
      displayName: user.displayName ?? "",
      username: user.username ?? "",
      bio: user.bio ?? "",
    });

    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveEditing = async () => {
    if (!canSave) {
      return;
    }

    setSaving(true);

    try {
      await updateProfile({
        display_name: draft.displayName,
        username: nextUsername,
        bio: draft.bio,
      });

      await refreshProfile();

      setIsEditing(false);
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(error?.message || "Failed to update profile.");
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
      toast.error(
        error?.message || "Failed to load friends."
      );
    } finally {
      reset ? setLoadingSection(false) : setLoadingMore(false);
    }
  };

  const loadRequestsPage = async (reset = false) => {
    const nextOffset = reset ? 0 : requestsOffset;

    reset ? setLoadingSection(true) : setLoadingMore(true);

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
      toast.error(
        error?.message || "Failed to load requests."
      );
    } finally {
      reset ? setLoadingSection(false) : setLoadingMore(false);
    }
  };

  const loadSentPage = async (reset = false) => {
    const nextOffset = reset ? 0 : sentOffset;

    reset ? setLoadingSection(true) : setLoadingMore(true);

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
      toast.error(
        error?.message || "Failed to load sent requests."
      );
    } finally {
      reset ? setLoadingSection(false) : setLoadingMore(false);
    }
  };


  // Whichever sub-tab is active loads from page 1.

  useEffect(() => {
    if (managementTab === "friends") {
      loadFriendsPage(true);
    } else if (managementTab === "requests") {
      loadRequestsPage(true);
    } else if (managementTab === "sent") {
      loadSentPage(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managementTab, user.id]);


  // ---------------------------------------------------------------------------
  // Confirmation actions
  // ---------------------------------------------------------------------------

  const requestRemoveFriend = (friend) => {
    setConfirmAction({
      type: "remove-friend",
      id: friend.id,
      label: friend.username,
    });
  };


  const requestDeclineFriendRequest = (request) => {
    setConfirmAction({
      type: "decline-friend-request",
      id: request.friendship_id,
      label: request.sender?.username || "this request",
    });
  };


  const requestCancelSentRequest = (request) => {
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

    setConfirmAction(null);
  };


  const reloadActiveManagementTab = async () => {
    if (managementTab === "friends") {
      await loadFriendsPage(true);
    } else if (managementTab === "requests") {
      await loadRequestsPage(true);
    } else if (managementTab === "sent") {
      await loadSentPage(true);
    }
  };


  const applyAction = async () => {
    if (!confirmAction) {
      return;
    }

    setRunningAction(true);

    try {
      if (confirmAction.type === "remove-friend") {
        await removeFriend(confirmAction.id);
      }

      if (confirmAction.type === "decline-friend-request") {
        await declineFriendRequest(confirmAction.id);
      }

      if (confirmAction.type === "cancel-friend-request") {
        await cancelFriendRequest(confirmAction.id);
      }

      await refreshProfile();
      await reloadActiveManagementTab();

      const messages = {
        "remove-friend": "Friend removed.",
        "decline-friend-request": "Friend request declined.",
        "cancel-friend-request": "Friend request cancelled.",
      };
      toast.success(messages[confirmAction.type]);
      setConfirmAction(null);
    } catch (error) {
      toast.error(
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

    try {
      const room = await openDm(friend);

      navigateToRoom(room);
      onClose();
    } catch (error) {
      toast.error(
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
                        toast.success("Friend request accepted.");

                        await Promise.all([
                          refreshProfile(),
                          loadRequestsPage(true),
                        ]);
                      } catch (error) {
                        toast.error(
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
                        aria-label="Display name"
                        aria-describedby={displayNameCountId}
                        aria-invalid={displayNameOverLimit}
                        $invalid={displayNameOverLimit}
                      />
                      <DisplayNameByteCount
                        id={displayNameCountId}
                        bytes={displayNameBytes}
                        maxBytes={MAX_DISPLAY_NAME_BYTES}
                        aria-label={`${displayNameBytes} of ${MAX_DISPLAY_NAME_BYTES} bytes`}
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
                        required
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

              <Divider />

              {isEditing ? (
                <BioEditor>
                  <BioInput
                    value={draft.bio}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        bio: limitMessageInput(e.target.value, MAX_BIO_INPUT_BYTES),
                      }))
                    }
                    maxLength={MAX_BIO_INPUT_BYTES}
                    aria-label="Bio"
                    aria-describedby={bioCountId}
                    aria-invalid={bioOverLimit}
                    $invalid={bioOverLimit}
                    placeholder="Write something about yourself..."
                    rows={3}
                  />
                  <BioByteCount
                    id={bioCountId}
                    bytes={bioBytes}
                    maxBytes={MAX_BIO_BYTES}
                    aria-label={`${bioBytes} of ${MAX_BIO_BYTES} bytes`}
                  />
                </BioEditor>
              ) : (
                <Bio>
                  {user.bio}
                </Bio>
              )}

              {/* ------------------------------------------------------------- */}
              {/* FRIENDS / NOTIFICATIONS                                        */}
              {/* ------------------------------------------------------------- */}

              <SectionPanel>
                <SectionTabs role="group" aria-label="Profile sections">
                  <SectionTab
                    type="button"
                    $active={managementSection === "friends"}
                    aria-pressed={managementSection === "friends"}
                    onClick={() => setManagementSection("friends")}
                  >
                    Friends
                  </SectionTab>
                  <SectionTab
                    type="button"
                    $active={managementSection === "notifications"}
                    aria-pressed={managementSection === "notifications"}
                    onClick={() => setManagementSection("notifications")}
                  >
                    Notifications
                  </SectionTab>
                </SectionTabs>

                {managementSection === "friends" && (
                  <SubTabs>
                    <SubTab
                      type="button"
                      $active={managementTab === "friends"}
                      aria-pressed={managementTab === "friends"}
                      onClick={() => setManagementTab("friends")}
                    >
                      Friends
                    </SubTab>

                    <SubTab
                      type="button"
                      $active={managementTab === "requests"}
                      aria-pressed={managementTab === "requests"}
                      onClick={() => setManagementTab("requests")}
                    >
                      Incoming
                    </SubTab>

                    <SubTab
                      type="button"
                      $active={managementTab === "sent"}
                      aria-pressed={managementTab === "sent"}
                      onClick={() => setManagementTab("sent")}
                    >
                      Sent
                    </SubTab>

                    <FriendInvite
                      onSent={() => setManagementTab("sent")}
                    />
                  </SubTabs>
                )}

                <ManagementContent>
                  {managementSection === "friends" && (
                    loadingSection ? (
                      <EmptyState>
                        Loading...
                      </EmptyState>
                    ) : (
                      renderFriendsManagement()
                    )
                  )}
                </ManagementContent>
              </SectionPanel>
        </Content>

        {/* ----------------------------------------------------------------- */}
        {/* CONFIRMATION                                                       */}
        {/* ----------------------------------------------------------------- */}

        <ConfirmDialog
          open={Boolean(confirmAction)}
          position={isPhone ? "fixed" : "absolute"}
          title={confirmAction ? CONFIRM_TITLES[confirmAction.type] : ""}
          text={
            confirmAction
              ? CONFIRM_TEXTS[confirmAction.type]?.(confirmAction.label)
              : ""
          }
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

  @media ${PHONE_QUERY} {
    overscroll-behavior-y: contain;
  }
`;

const Card = styled.div`
  position: relative;
  margin-block: auto;
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

  @media ${PHONE_QUERY} {
    flex-shrink: 0;
    height: auto;
    min-height: 85vh;
  }
`;

const Banner = styled.div`
  flex-shrink: 0;
  height: 100px;
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent-600) 55%, var(--bg-base)),
    color-mix(in srgb, var(--accent-600) 12%, var(--bg-base))
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

const Content = styled.div`
  flex: 1;
  min-height: 0;
  padding: 0 var(--space-6) var(--space-6);
  display: flex;
  flex-direction: column;
  overflow: hidden;

  @media ${PHONE_QUERY} {
    flex: none;
    overflow: visible;
  }
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

const DisplayNameByteCount = styled(MessageByteCount)`
  text-align: right;
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

const BioEditor = styled.div`
  flex-shrink: 0;
  margin-top: var(--space-5);
`;

const BioInput = KitTextArea;

const BioByteCount = styled(MessageByteCount)`
  margin-top: var(--space-1);
  text-align: right;
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
  overflow-wrap: anywhere;
`;

// =============================================================================
// Friends / Notifications — section tabs, then friends sub-tabs,
// then the list itself. Phones scroll the whole overlay.
// =============================================================================

const SectionPanel = styled.div`
  flex: 1;
  min-height: 0;
  margin-top: var(--space-5);
  display: flex;
  flex-direction: column;

  @media ${PHONE_QUERY} {
    flex: none;
  }
`;

const SectionTabs = styled(TabList)`
  flex-shrink: 0;
  gap: 0;
  margin-bottom: var(--space-3);
`;

const SectionTab = styled(Tab)`
  flex: 1;
  min-width: 0;
  text-align: center;
`;

const SubTabs = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  /* The tabs and the request box together are wider than the card gets on a
     phone, so let the box drop to a line of its own. */
  flex-wrap: wrap;
`;

const SubTab = styled(Tab)`
  padding: var(--space-2) 12px;
  border-radius: 0;
  font-size: var(--text-sm);
  transition:
    color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);

  &:hover {
    background: var(--bg-hover);
  }
`;

const ManagementContent = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;

  @media ${PHONE_QUERY} {
    flex: none;
  }
`;

const ExpandedListPanel = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;

  @media ${PHONE_QUERY} {
    flex: none;
    overflow-y: visible;
  }
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
