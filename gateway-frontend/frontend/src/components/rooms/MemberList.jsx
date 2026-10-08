import MemberItem from "./MemberItem";
import styled from "styled-components";
import { TbShieldCheck, TbShieldOff, TbUserX } from "react-icons/tb";

const MemberListRoot = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
`;

/**
 * What the current user may do to a given member.
 *
 * org-service is deliberately asymmetric: kicking needs owner *or* admin, but
 * only the owner may hand out or take back the admin role. Mirroring that here
 * keeps the menu from offering an option that comes back a 403.
 */
function memberActions({
  currentUserId,
  currentUserRole,
  member,
  onKick,
  onPromote,
  onDemote,
}) {
  if (currentUserRole !== "owner" && currentUserRole !== "admin") return [];
  if (member.id === currentUserId) return [];
  if (member.role === "owner") return [];
  if (currentUserRole === "admin" && member.role === "admin") return [];

  const actions = [];

  if (currentUserRole === "owner") {
    actions.push(
      member.role === "admin"
        ? {
            key: "demote",
            label: "Remove admin",
            icon: TbShieldOff,
            onSelect: () => onDemote?.(member),
          }
        : {
            key: "promote",
            label: "Make admin",
            icon: TbShieldCheck,
            onSelect: () => onPromote?.(member),
          }
    );
  }

  actions.push({
    key: "kick",
    label: "Kick user",
    icon: TbUserX,
    danger: true,
    onSelect: () => onKick?.(member),
  });

  return actions;
}

function MemberList({
  members,
  currentUserId,
  currentUserRole,
  onKick,
  onPromote,
  onDemote,
}) {
  return (
    <MemberListRoot>
      {members.map((member) => (
        <MemberItem
          key={member.id}
          member={member}
          actions={memberActions({
            currentUserId,
            currentUserRole,
            member,
            onKick,
            onPromote,
            onDemote,
          })}
        />
      ))}
    </MemberListRoot>
  );
}

export default MemberList;