import { useEffect, useState } from "react";
import styled from "styled-components";
import { TbHash } from "react-icons/tb";
import { getUserById } from "../../api/users";
import UserAvatar from "../profile/UserAvatar";

const Intro = styled.header`
  padding: var(--space-5) var(--space-2);
  overflow-wrap: anywhere;

  h3 {
    margin: var(--space-3) 0 var(--space-1);
    color: var(--text-primary);
    font-size: clamp(var(--text-xl), 3vw, 28px);
    line-height: 1.25;
  }

  p {
    margin: var(--space-2) 0 0;
    color: var(--text-secondary);
  }
`;

const RoomIcon = styled.div`
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  color: var(--text-secondary);
`;

const Username = styled.div`
  color: var(--text-tertiary);
  font-size: var(--text-sm);
`;

const Bio = styled.p`
  max-width: 60ch;
  white-space: pre-wrap;
`;

function ConversationIntro({ roomName, isDm, peer, isEmpty }) {
  const [profile, setProfile] = useState(null);
  const peerId = isDm ? peer?.id : null;

  // Some DM entry points carry only an ID and username. Reuse the session
  // cache to fill in the avatar and bio without delaying the conversation.
  useEffect(() => {
    if (!peerId) return undefined;
    let cancelled = false;
    getUserById(peerId)
      .then((user) => { if (!cancelled) setProfile(user); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [peerId]);

  const user = profile?.id === peerId ? profile : peer;
  const username = user?.username || roomName;
  const displayName = user?.display_name?.trim() || username;
  const bio = user?.bio?.trim();

  return (
    <Intro aria-label="Beginning of conversation">
      {isDm ? (
        <UserAvatar avatar={user?.avatar} name={username} $size={64} />
      ) : (
        <RoomIcon aria-hidden="true"><TbHash size={32} /></RoomIcon>
      )}
      <h3>{isDm ? displayName : `#${roomName}`}</h3>
      {isDm && displayName !== username && <Username>@{username}</Username>}
      {isDm && bio && <Bio>{bio}</Bio>}
      <p>
        {isDm
          ? `This is the beginning of your conversation with ${username}.`
          : `This is the beginning of the #${roomName} room.`}
      </p>
      {isEmpty && <p>Say hello and send the first message.</p>}
    </Intro>
  );
}

export default ConversationIntro;
