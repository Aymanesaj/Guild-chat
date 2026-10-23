import { useCallback, useEffect, useId, useRef } from "react";
import styled from "styled-components";
import { useToast } from "../ui/ToastProvider";
import { TbArrowBackUp, TbSend, TbX } from "react-icons/tb";
import { Button, IconButton, Input } from "../ui";
import MessageByteCount from "../ui/MessageByteCount";
import { MAX_MESSAGE_BYTES, MAX_MESSAGE_INPUT_BYTES, MESSAGE_SIZE_ERROR, limitMessageInput, messageByteLength } from "../../utils/messageContent";

const MessageComposerRoot = styled.div`
  display: flex;
  flex-direction: column;
`;

const MessageComposerForm = styled.form`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-3) var(--space-4);
`;

const ByteCount = styled(MessageByteCount)`
  grid-column: 2;
  justify-self: center;
  max-width: 96px;
  text-align: center;
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

  @media (max-width: 700px) {
    /* Avoid automatic input zoom changing the viewport while typing on iOS. */
    font-size: 16px;
  }
`;

const SendButton = styled(Button)`
  justify-self: center;

  @media (max-width: 700px) {
    span {
      display: none;
    }
  }
`;

function MessageComposer({
  roomId, roomName, isDm, text, onTextChange, onSend, disabled,
  replyingTo, onCancelReply, focusEnabled = true,
}) {
  const toast = useToast();
  const setToastAnchor = useCallback((element) => toast.setAnchor(element), [toast]);
  const inputRef = useRef(null);
  const submitting = useRef(false);
  const countId = useId();
  const label = isDm ? `Message ${roomName}` : `Message #${roomName}`;
  const bytes = messageByteLength(text);
  const overLimit = bytes > MAX_MESSAGE_BYTES;

  // Covers opening a room, picking a reply and re-enabling the input after send.
  useEffect(() => {
    if (!disabled && focusEnabled) inputRef.current?.focus({ preventScroll: true });
  }, [roomId, disabled, replyingTo, focusEnabled]);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmed = text.trim();
    if (!trimmed || disabled || submitting.current) return;
    if (overLimit) {
      toast.error(MESSAGE_SIZE_ERROR);
      return;
    }

    submitting.current = true;
    try {
      await onSend(trimmed, replyingTo?.id);
      // A late response must not erase a newer draft written after revisiting this room.
      onTextChange((current) => current === text ? "" : current);
      onCancelReply?.();
    } catch (error) {
      toast.error(error?.message || "Couldn't send your message. Please try again.");
    } finally {
      submitting.current = false;
    }
  }

  return (
    <MessageComposerRoot ref={setToastAnchor}>
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
          onChange={(event) => onTextChange(limitMessageInput(event.target.value))}
          maxLength={MAX_MESSAGE_INPUT_BYTES}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancelReply?.();
          }}
          placeholder={label}
          aria-label={label}
          aria-describedby={countId}
          aria-invalid={overLimit}
          $invalid={overLimit}
          autoFocus={focusEnabled}
          disabled={disabled}
        />

        <SendButton type="submit" $pill disabled={disabled || !text.trim() || overLimit}>
          <TbSend size={18} />
          <span>Send</span>
        </SendButton>
        <ByteCount id={countId} bytes={bytes} />
      </MessageComposerForm>
    </MessageComposerRoot>
  );
}

export default MessageComposer;
