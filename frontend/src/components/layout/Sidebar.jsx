import { useEffect, useState } from "react";
import styled from "styled-components";
import { getRooms } from "../../api/rooms";

const SidebarRoot = styled.aside`
  display: flex;
  flex-direction: column;
  width: 280px;
  flex-shrink: 0;
  padding: 16px;
  background: var(--color-bg);

  @media (max-width: 700px) {
    width: 76px;
    padding: 10px;
  }
`;

const SidebarHeaderBox = styled.div`
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-text);
`;

const SidebarTitle = styled.h1`
  margin: 0;
  font-size: 20px;
  color: var(--color-accent);

  @media (max-width: 700px) {
    display: none;
  }
`;

const SidebarSection = styled.section`
  padding-top: 20px;
`;

const SectionTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: bold;
  text-transform: uppercase;

  @media (max-width: 700px) {
    span {
      display: none;
    }
  }
`;

const SectionActionButton = styled.button`
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 20px;
`;

const StatusMessage = styled.p`
  margin: 8px 0 0;
  color: var(--color-text-muted);
`;

const RoomListNav = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
`;

const SidebarItemButton = styled.button`
  width: 100%;
  border: 0;
  border-radius: 4px;
  padding: 8px;
  background: ${({ $active }) => ($active ? "var(--color-surface-hover)" : "transparent")};
  color: var(--color-text-muted);
  text-align: left;

  &:hover {
    color: var(--color-accent);
  }

  @media (max-width: 700px) {
    display: block;
    height: 40px;
    padding: 0;
    text-align: center;
    font-size: 0;

    &::first-letter {
      font-size: 18px;
    }
  }
`;

const DmButton = styled.button`
  width: 100%;
  border: 0;
  border-radius: 4px;
  padding: 8px;
  background: ${({ $active }) => ($active ? "var(--color-accent)" : "transparent")};
  color: var(--color-text-muted);
  text-align: left;
  font-weight: bold;

  &:hover {
    background: var(--color-accent);
  }

  @media (max-width: 700px) {
    display: block;
    height: 40px;
    padding: 0;
    text-align: center;
    font-size: 0;

    &::first-letter {
      font-size: 18px;
    }
  }
`;

const DirectMessagesSection = styled.section`
  padding-top: 20px;
`;

const ProfilePreviewBox = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding: 18px;
  border-top: 1px solid var(--color-text);

  strong,
  span {
    display: block;
  }

  span {
    color: var(--color-text-muted);
    font-size: 12px;
  }

  @media (max-width: 700px) {
    justify-content: center;

    > div:last-child {
      display: none;
    }
  }
`;

const Avatar = styled.div`
  display: grid;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  place-items: center;
  background: var(--color-accent);
  font-weight: bold;
`;

export const ProfileName = styled.button`
  border: 0;
  background: transparent;
  color: var(--color-text);
  font-weight: bold;
  text-align: left;
  &:hover {
    color: var(--color-text-muted);    
  }
`;

function Sidebar({
  isDirectMessages,
  activeRoomId,
  onRoomChange,
  onDirectMessages,
}) {
  const [rooms, setRooms] = useState([]);
  const [loaded, setLoaded] = useState("loading");

  useEffect(() => {
    async function loadRooms() {
      try {
        const data = await getRooms();
        setRooms(data);
        setLoaded("success");
      } catch (error) {
        console.error("Error fetching rooms:", error);
        setLoaded("error");
      }
    }

    loadRooms();
  }, []);

  return (
    <SidebarRoot>
      <SidebarHeader />


      <DirectMessagesButton
        isDirectMessages={isDirectMessages}
        onDirectMessages={onDirectMessages}
      />

      <RoomsSection
        rooms={rooms}
        isDirectMessages={isDirectMessages}
        activeRoomId={activeRoomId}
        onRoomChange={onRoomChange}
        state={loaded}
      />

      <ProfilePreview />
    </SidebarRoot>
  );
}

function SidebarHeader() {
  return (
    <SidebarHeaderBox>
      <SidebarTitle>RAHMOHAM</SidebarTitle>
    </SidebarHeaderBox>
  );
}

function RoomsSection({ rooms, isDirectMessages, activeRoomId, onRoomChange, state }) {
  return (
    <SidebarSection>
      <SectionTitle title="Rooms" actionLabel="Create room" />

      {state === "loading" && <StatusMessage>Loading rooms...</StatusMessage>}
      {state === "error" && <StatusMessage>Error loading rooms.</StatusMessage>}

      <RoomListNav aria-label="Rooms">
        {rooms.map((room) => (
          <RoomButton
            key={room.id}
            room={room}
            active={!isDirectMessages && activeRoomId === room.id}
            onClick={() => onRoomChange(room)}
          />
        ))}
      </RoomListNav>
    </SidebarSection>
  );
}

function SectionTitle({ title, actionLabel }) {
  return (
    <SectionTitleRow>
      <span>{title}</span>
      <SectionActionButton type="button" aria-label={actionLabel}>
        +
      </SectionActionButton>
    </SectionTitleRow>
  );
}

function RoomButton({ room, active, onClick }) {
  return (
    <SidebarItemButton type="button" $active={active} onClick={onClick}>
      # {room.name}
    </SidebarItemButton>
  );
}

function DirectMessagesButton({ isDirectMessages, onDirectMessages }) {
  return (
    <DirectMessagesSection>
      <DmButton
        type="button"
        $active={isDirectMessages}
        onClick={onDirectMessages}
      >
        Direct Messages
      </DmButton>
    </DirectMessagesSection>
  );
}

function ProfilePreview() {
  return (
    <ProfilePreviewBox>
      <Avatar>M</Avatar>

      <div>
        <ProfileName>Mohamed</ProfileName>
        <span>Online</span>
      </div>
    </ProfilePreviewBox>
  );
}

export default Sidebar;