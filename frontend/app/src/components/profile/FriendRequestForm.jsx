import { useState } from "react";
import styled from "styled-components";
import { TbSend } from "react-icons/tb";

import { getUserByUsername } from "../../api/profile";
import { sendFriendRequest } from "../../api/friends";
import { IconButton as KitIconButton, Input as KitInput } from "../ui";

/**
 * Send a friend request by username. Pushes itself to the far right of
 * whatever flex row it sits in. With `onError` the caller shows failures;
 * without it they, and a short confirmation, show under the input.
 */
export default function FriendRequestForm({ onSent, onError, className }) {
  const [username, setUsername] = useState("");
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState(null);

  const report = (message) => {
    if (onError) {
      onError(message);
    } else {
      setHint(message ? { text: message, error: true } : null);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const query = username.trim();

    if (!query) {
      report("Enter a username to add.");
      return;
    }

    setSending(true);
    setHint(null);
    report("");

    try {
      const match = await getUserByUsername(query);

      await sendFriendRequest(match.id);

      setUsername("");
      if (!onError) {
        setHint({ text: `Request sent to @${query}` });
      }
      onSent?.();
    } catch (error) {
      report(error?.message || "Failed to add friend.");
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
          setHint(null);
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

      {hint && (
        <Hint role="status" $error={hint.error}>
          {hint.text}
        </Hint>
      )}
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

/* Out of flow so a message doesn't change the height of the row it sits in. */
const Hint = styled.span`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: ${({ $error }) => ($error ? "var(--danger)" : "var(--success)")};
`;
