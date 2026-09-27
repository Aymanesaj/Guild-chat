import { useEffect, useState } from "react";
import styled from "styled-components";
import { TbArrowLeft, TbUserPlus, TbUsersGroup, TbX } from "react-icons/tb";

import MemberList from "./MemberList";
import { addMember, assignRole, getRoomMembers, removeMember } from "../../api/rooms";
import { getFriendsList } from "../../api/friends";
import { usePresence } from "../../hooks/usePresence";
import { useProfileOverlay } from "../layout/ProfileOverlayContext";
import { useNavDrawer } from "../layout/NavDrawerContext";
import {
  ConfirmDialog,
  EmptyState,
  IconButton,
  InlineError,
  StatusText,
} from "../ui";
import UserAvatar from "../profile/UserAvatar";

const MembersSidebarRoot = styled.aside`
  display: flex;
  width: 260px;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  padding: var(--space-4);
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-surface);

  /* Inside the phone drawer the panel fills it, and the roster — not the
     panel — is what scrolls, so the confirm dialog stays put over it. */
  @media (max-width: 700px) {
    width: 100%;
    border-left: 0;
  }
`;

const SidebarHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-1);
`;

const MembersTitle = styled.h3`
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const FriendRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease);

  &:hover {
    background: var(--bg-hover);
  }
`;

const FriendName = styled.span`
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ListArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: var(--space-3);
`;

function MembersSidebar({ roomId, onClose }) {
  const { currentUser } = useProfileOverlay();
  const { isPhone } = useNavDrawer();
  const [view, setView] = useState("members");

  const [loading, setLoading] = useState("loading");
  const [members, setMembers] = useState([]);
  const [kickError, setKickError] = useState(null);
  const [pendingKick, setPendingKick] = useState(null);
  const [kicking, setKicking] = useState(false);
  // Its own slot: ConfirmDialog shows one thing at a time.
  const [pendingRole, setPendingRole] = useState(null);
  const [roleError, setRoleError] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);

  const presence = usePresence(members.map((member) => member.id));

  const [friendsLoading, setFriendsLoading] = useState("idle");
  const [friends, setFriends] = useState([]);
  const [addingId, setAddingId] = useState(null);
  const [addError, setAddError] = useState(null);

  useEffect(() => {
    const fetchMembers = async () => {
      setLoading("loading");
      try {
        const roomMembers = await getRoomMembers(roomId);
        setMembers(roomMembers);
        setLoading("success");
      } catch {
        setLoading("error");
      }
    };

    fetchMembers();
  }, [roomId]);

  useEffect(() => {
    if (view !== "friends") {
      return;
    }

    const fetchFriends = async () => {
      setFriendsLoading("loading");

      try {
        const friendsData = await getFriendsList();
        setFriends(Array.isArray(friendsData) ? friendsData : []);
        setFriendsLoading("success");
      } catch {
        setFriendsLoading("error");
      }
    };

    fetchFriends();
  }, [view]);

  const memberIds = new Set(members.map((member) => member.id));
  const invitableFriends = friends.filter(
    (friend) => !memberIds.has(friend.id)
  );

  const currentUserRole = members.find(
    (member) => member.id === currentUser?.id
  )?.role;
  // org-service has no invites: owners/admins add members directly.
  const canAddMembers =
    currentUserRole === "owner" || currentUserRole === "admin";

  const confirmKick = async () => {
    if (!pendingKick) return;

    setKicking(true);
    setKickError(null);
    try {
      await removeMember(roomId, pendingKick.id);
      setMembers((prev) => prev.filter((item) => item.id !== pendingKick.id));
      setPendingKick(null);
    } catch {
      setKickError(`Couldn't remove ${pendingKick.username}.`);
    } finally {
      setKicking(false);
    }
  };

  const confirmRoleChange = async () => {
    if (!pendingRole) return;

    const { member, nextRole } = pendingRole;

    setRoleBusy(true);
    setRoleError(null);
    try {
      await assignRole(roomId, member.id, nextRole);
      // The endpoint answers 204 with no body, so the roster is updated here.
      setMembers((prev) =>
        prev.map((item) =>
          item.id === member.id ? { ...item, role: nextRole } : item
        )
      );
      setPendingRole(null);
    } catch {
      setRoleError(
        nextRole === "admin"
          ? `Couldn't make ${member.username} an admin.`
          : `Couldn't remove ${member.username}'s admin role.`
      );
    } finally {
      setRoleBusy(false);
    }
  };

  const handleAdd = async (friend) => {
    setAddingId(friend.id);
    setAddError(null);

    try {
      await addMember(roomId, friend.id);
      setMembers((prev) => [
        ...prev,
        { ...friend, role: "member" },
      ]);
    } catch (error) {
      setAddError(error?.message || `Couldn't add ${friend.username}.`);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <MembersSidebarRoot>
      <SidebarHeader>
        <MembersTitle>
          {view === "members"
            ? `Members — ${members.length}`
            : `Friends — ${invitableFriends.length}`}
        </MembersTitle>

        <HeaderActions>
          {(view !== "members" || canAddMembers) && (
            <IconButton
              type="button"
              $size={26}
              onClick={() =>
                setView(view === "members" ? "friends" : "members")
              }
              aria-label={
                view === "members"
                  ? "Add friends"
                  : "Back to members"
              }
              title={view === "members" ? "Add friends" : "Back to members"}
            >
              {view === "members" ? (
                <TbUserPlus size={18} />
              ) : (
                <TbArrowLeft size={18} />
              )}
            </IconButton>
          )}

          {/* Desktop closes this from the header toggle, which the drawer
              covers on a phone. */}
          {isPhone && (
            <IconButton
              type="button"
              $size={26}
              onClick={onClose}
              aria-label="Close members"
              title="Close members"
            >
              <TbX size={18} />
            </IconButton>
          )}
        </HeaderActions>
      </SidebarHeader>

      <ListArea>
        {view === "members" ? (
          <>
            {loading === "loading" && <StatusText>Loading members...</StatusText>}
            {loading === "error" && <InlineError>Error loading members.</InlineError>}
            {kickError && !pendingKick && (
              <InlineError role="alert">{kickError}</InlineError>
            )}
            {roleError && !pendingRole && (
              <InlineError role="alert">{roleError}</InlineError>
            )}
            {loading === "success" && (
              <MemberList
                members={members.map((member) => ({
                  ...member,
                  status: presence.get(member.id) ?? member.status,
                }))}
                currentUserId={currentUser?.id}
                currentUserRole={currentUserRole}
                onKick={setPendingKick}
                onPromote={(member) =>
                  setPendingRole({ member, nextRole: "admin" })
                }
                onDemote={(member) =>
                  setPendingRole({ member, nextRole: "member" })
                }
              />
            )}
          </>
        ) : (
          <>
            {friendsLoading === "loading" && <StatusText>Loading friends...</StatusText>}
            {friendsLoading === "error" && <InlineError>Error loading friends.</InlineError>}
            {addError && <InlineError role="alert">{addError}</InlineError>}
            {friendsLoading === "success" &&
              (invitableFriends.length > 0 ? (
                invitableFriends.map((friend) => {
                  const isAdding = addingId === friend.id;

                  return (
                    <FriendRow key={friend.id}>
                      <UserAvatar avatar={friend.avatar} name={friend.username} $size={28} />

                      <FriendName>{friend.username}</FriendName>

                      <IconButton
                        type="button"
                        $size={26}
                        onClick={() => handleAdd(friend)}
                        disabled={isAdding}
                        aria-label={`Add ${friend.username} to the room`}
                        title={`Add ${friend.username}`}
                      >
                        <TbUserPlus size={16} />
                      </IconButton>
                    </FriendRow>
                  );
                })
              ) : (
                <EmptyState
                  icon={TbUsersGroup}
                  title={
                    friends.length === 0
                      ? "No friends yet."
                      : "Everyone's here"
                  }
                  hint={
                    friends.length === 0
                      ? "Add friends from their profile to invite them to rooms."
                      : "All your friends are already in this room."
                  }
                />
              ))}
          </>
        )}
      </ListArea>

      {/* Stays position:fixed. The drawer that wraps this panel is careful to
          rest at `transform: none` precisely so it never becomes the
          containing block for this backdrop. */}
      <ConfirmDialog
        open={Boolean(pendingKick)}
        title="Remove member?"
        text={
          pendingKick
            ? `Remove ${pendingKick.username} from this room?`
            : ""
        }
        error={kickError}
        confirmLabel="Remove"
        busyLabel="Removing..."
        busy={kicking}
        onConfirm={confirmKick}
        onCancel={() => {
          setPendingKick(null);
          setKickError(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingRole)}
        title={
          pendingRole?.nextRole === "admin" ? "Make admin?" : "Remove admin?"
        }
        text={
          pendingRole
            ? pendingRole.nextRole === "admin"
              ? `Give ${pendingRole.member.username} admin rights in this room?`
              : `Take away ${pendingRole.member.username}'s admin rights?`
            : ""
        }
        error={roleError}
        confirmLabel={
          pendingRole?.nextRole === "admin" ? "Make admin" : "Remove admin"
        }
        busyLabel="Saving..."
        busy={roleBusy}
        onConfirm={confirmRoleChange}
        onCancel={() => {
          setPendingRole(null);
          setRoleError(null);
        }}
      />
    </MembersSidebarRoot>
  );
}

export default MembersSidebar;
