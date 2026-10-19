import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useToast } from "../ui/ToastProvider";
import { TbArrowBackUp, TbSend, TbX } from "react-icons/tb";
import { Button, IconButton, Input } from "../ui";

const MessageComposerRoot = styled.div`
  display: flex;
  flex-direction: column;
`;

const MessageComposerForm = styled.form`
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4) var(--space-4);
`;

const ReplyBanner = styled.div`
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0 var(--space-4);
  padding: var(--space-2) var(--space-3);
  border-left: 2px solid var(--accent-500);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--text-sm);

  svg {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }
`;

const ReplyBannerText = styled.span`
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  strong {
    color: var(--text-primary);
    font-weight: 600;
  }
`;

const ComposerInput = styled(Input)`
  min-width: 0;
  flex: 1;
  border-radius: var(--radius-pill);
  background: var(--bg-surface);
`;

const SendButton = styled(Button)`
  @media (max-width: 700px) {
    span {
      display: none;
    }
  }
`;

function MessageComposer({ roomName, isDm, onSend, disabled, replyingTo, onCancelReply }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  const label = isDm ? `Message ${roomName}` : `Message #${roomName}`;

  // Picking a reply should land the caret in the composer, not leave the user
  // to click into it after clicking the reply button.
  useEffect(() => {
    if (replyingTo) inputRef.current?.focus();
  }, [replyingTo]);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    try {
      await onSend(trimmed, replyingTo?.id);
      setText("");
      onCancelReply?.();
    } catch (error) {
      toast.error(error?.message || "Couldn't send your message. Please try again.");
    }
  }

  return (
    <MessageComposerRoot>
      {replyingTo && (
        <ReplyBanner>
          <TbArrowBackUp size={16} />
          <ReplyBannerText>
            Replying to <strong>{replyingTo.sender_username ?? "Unknown user"}</strong>
            {replyingTo.content ? ` — ${replyingTo.content}` : ""}
          </ReplyBannerText>
          <IconButton
            type="button"
            $size={24}
            onClick={onCancelReply}
            aria-label="Cancel reply"
            title="Cancel reply"
          >
            <TbX size={16} />
          </IconButton>
        </ReplyBanner>
      )}

      <MessageComposerForm onSubmit={handleSubmit}>
        <ComposerInput
          ref={inputRef}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancelReply?.();
          }}
          placeholder={label}
          aria-label={label}
          disabled={disabled}
        />

        <SendButton type="submit" $pill disabled={disabled || !text.trim()}>
          <TbSend size={18} />
          <span>Send</span>
        </SendButton>
      </MessageComposerForm>
    </MessageComposerRoot>
  );
}

export default MessageComposer;
