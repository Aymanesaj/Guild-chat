import styled from "styled-components";
import { TbMessageOff, TbPlugConnectedX } from "react-icons/tb";
import DmItem from "./DmItem";
import DmItemSkeleton from "./DmItemSkeleton";
import { EmptyState } from "../ui";
import FriendRequestForm from "../profile/FriendRequestForm";

const DmListRoot = styled.ul`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-4) 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
`;

/* Centered under the hint instead of pushed right like it is in a toolbar. */
const StartForm = styled(FriendRequestForm)`
  margin: var(--space-3) auto 0;
`;

function DmList({ conversations, state, onDelete }) {
  if (state === "loading") {
    return (
      <DmListRoot aria-busy="true">
        {Array.from({ length: 10 }).map((_, index) => (
          <DmItemSkeleton key={index} />
        ))}
      </DmListRoot>
    );
  }

  if (state === "error") {
    return (
      <DmListRoot>
        <li>
          <EmptyState
            icon={TbPlugConnectedX}
            title="Failed to load conversations."
            hint="Check your connection and try again."
          />
        </li>
      </DmListRoot>
    );
  }

  if (!conversations.length) {
    return (
      <DmListRoot>
        <li>
          <EmptyState
            icon={TbMessageOff}
            title="No conversations yet"
            hint="Start by adding friends — send a request. or start a conversation with a friend :)"
          >
            <StartForm />
          </EmptyState>
        </li>
      </DmListRoot>
    );
  }

  return (
    <DmListRoot>
      {conversations.map((conversation) => (
        <DmItem key={conversation.id} conversation={conversation} onDelete={onDelete} />
      ))}
    </DmListRoot>
  );
}

export default DmList;
