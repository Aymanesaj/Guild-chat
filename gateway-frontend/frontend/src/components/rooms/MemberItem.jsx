import { useState } from "react";
import styled from "styled-components";
import { TbDots } from "react-icons/tb";
import { useOpenUserPreview } from "../../hooks/useOpenUserPreview";
import { IconButton, StatusDot } from "../ui";
import UserAvatar from "../profile/UserAvatar";
import MemberActionsMenu from "./MemberActionsMenu";

const MemberItemRoot = styled.li`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 60px;
  padding: 10px var(--space-2);
  border-radius: var(--radius-md);
  transition: background var(--dur-fast) var(--ease);

  &:hover {
    background: var(--bg-hover);
  }
`;

const MemberIdentity = styled.button`
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--text-primary);
  text-align: left;

  &:hover {
    color: var(--accent-400);
  }
`;

const MemberAvatarWrap = styled.span`
  position: relative;
  display: block;
  flex-shrink: 0;
`;

const MemberStatus = styled(StatusDot)`
  position: absolute;
  right: -1px;
  bottom: -1px;
`;

const MemberDetails = styled.span`
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
`;

const MemberName = styled.span`
  overflow: hidden;
  color: inherit;
  font-size: var(--text-md);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease);
`;

const MemberRole = styled.span`
  align-self: flex-start;
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-400);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: capitalize;
`;

function MemberItem({ member, actions }) {
  const openPreview = useOpenUserPreview();
  const [menuRect, setMenuRect] = useState(null);

  return (
    <MemberItemRoot>
      <MemberIdentity type="button" onClick={openPreview(member)}>
        <MemberAvatarWrap>
          <UserAvatar avatar={member.avatar} name={member.username} $size={40} />
          <MemberStatus
            $online={member.status === "online"}
            $size={12}
            $ring="var(--bg-surface)"
            aria-label={member.status}
          />
        </MemberAvatarWrap>

        <MemberDetails>
          <MemberName title={member.username}>{member.username}</MemberName>
          {(member.role === "owner" || member.role === "admin") && (
            <MemberRole>{member.role}</MemberRole>
          )}
        </MemberDetails>
      </MemberIdentity>

      {actions.length > 0 && (
        <IconButton
          type="button"
          $size={36}
          onClick={(event) => setMenuRect(event.currentTarget.getBoundingClientRect())}
          aria-label={`Manage ${member.username}`}
          title={`Manage ${member.username}`}
          aria-haspopup="menu"
          aria-expanded={Boolean(menuRect)}
        >
          <TbDots size={20} />
        </IconButton>
      )}

      {menuRect && (
        <MemberActionsMenu
          anchorRect={menuRect}
          actions={actions}
          onClose={() => setMenuRect(null)}
        />
      )}
    </MemberItemRoot>
  );
}

export default MemberItem;
