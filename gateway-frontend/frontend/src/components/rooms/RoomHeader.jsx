import { useState } from "react";
import styled from "styled-components";
import { TbHash, TbMessageCircle, TbUsers } from "react-icons/tb";
import { Button } from "../ui";
import { NavToggleButton } from "../layout/NavDrawerContext";

const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
`;

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: var(--text-tertiary);

  h2 {
    overflow: hidden;
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-lg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

/* The header now also carries a hamburger on phones; at 360px the label is
   what has to give. */
const MembersButton = styled(Button)`
  @media (max-width: 700px) {
    span {
      display: none;
    }
  }
`;

function RoomHeader({ roomName, isDm, onToggleMembers, onHideDm }) {
  const [removing, setRemoving] = useState(false);
  const removeConversation = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await onHideDm();
    } finally {
      setRemoving(false);
    }
  };
  const TitleIcon = isDm ? TbMessageCircle : TbHash;

  return (
    <PanelHeader>
      <HeaderTitle>
        <NavToggleButton />
        <TitleIcon size={20} />
        <h2>{roomName}</h2>
      </HeaderTitle>

      {isDm && onHideDm && (
        <Button type="button" $variant="ghost" $size="sm"
          disabled={removing} onClick={removeConversation}>
          Remove conversation
        </Button>
      )}

      {/* A DM has exactly two members and no roster to manage. */}
      {!isDm && (
        <MembersButton
          type="button"
          $variant="ghost"
          $size="sm"
          onClick={onToggleMembers}
          title="Toggle members"
          aria-label="Toggle members"
        >
          <TbUsers size={18} />
          <span>Members</span>
        </MembersButton>
      )}
    </PanelHeader>
  );
}

export default RoomHeader;
