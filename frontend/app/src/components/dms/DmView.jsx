import DmList from "./DmList";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { TbMessageCircle } from "react-icons/tb";
import { listDmConversations } from "../../api/rooms";
import { usePresence } from "../../hooks/usePresence";
import { NavToggleButton } from "../layout/NavDrawerContext";

const DmViewShell = styled.section`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  padding: var(--space-4);
  background: var(--bg-base);
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-tertiary);

  h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-lg);
    font-weight: 600;
  }
`;

function DmView() {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState("loading");

  useEffect(() => {
    async function loadMessages() {
      try {
        setConversations(await listDmConversations());
        setLoading("success");
      } catch (error) {
        console.error(error);
        setLoading("error");
      }
    }
    loadMessages();
  }, []);

  const presence = usePresence(conversations.map((conversation) => conversation.userId));
  const withPresence = conversations.map((conversation) => ({
    ...conversation,
    status: presence.get(conversation.userId) ?? conversation.status,
  }));

  return (
    <DmViewShell>
      <PanelHeader>
        <NavToggleButton />
        <TbMessageCircle size={20} />
        <h2>Direct Messages</h2>
      </PanelHeader>

      <DmList
        conversations={withPresence}
        state={ loading }
      />
    </DmViewShell>
  );
}

export default DmView;