import { useState } from "react";
import styled from "styled-components";
import { useToast } from "../ui/ToastProvider";
import { TbSend } from "react-icons/tb";

import { getUserByUsername } from "../../api/profile";
import { sendFriendRequest } from "../../api/friends";
import { IconButton as KitIconButton, Input as KitInput } from "../ui";

/** Send a friend request by username with shared toast feedback. */
export default function FriendRequestForm({ onSent, className }) {
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const query = username.trim();

    if (!query) {
      toast.error("Enter a username to add.");
      return;
    }

    setSending(true);

    try {
      const match = await getUserByUsername(query);

      await sendFriendRequest(match.id);

      setUsername("");
      toast.success(`Request sent to @${query}.`);
      onSent?.();
    } catch (error) {
      toast.error(error?.message || "Failed to add friend.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Form onSubmit={handleSubmit} className={className}>
      <FormInput
        value={username}
        onChange={(e) => {
          setUsername(e.target.value);
        }}
        placeholder="Request by username"
        aria-label="Send a friend invite by username"
      />

      <FormButton
        type="submit"
        disabled={sending}
        aria-label="Send friend invite"
        title="Send friend invite"
      >
        <TbSend size={16} />
      </FormButton>
    </Form>
  );
}

const Form = styled.form`
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  /* Never force the row wider than its container; shrink before overflowing. */
  min-width: 0;
`;

const FormInput = styled(KitInput)`
  width: 170px;
  padding: 6px 10px;
  font-size: var(--text-sm);

  @media (max-width: 700px) {
    width: auto;
    flex: 1;
    /* Text inputs default to min-width:auto, which is what pushes them past
       the edge of a flex container. */
    min-width: 0;
  }
`;

const FormButton = styled(KitIconButton).attrs({ $size: 28 })`
  flex-shrink: 0;
  border-color: var(--border-strong);
`;
