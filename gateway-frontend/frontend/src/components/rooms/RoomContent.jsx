import { Fragment, useEffect, useId, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { useToast } from "../ui/ToastProvider";
import {
  TbAlertTriangle,
  TbArrowBackUp,
  TbArrowBarToDown,
  TbArrowBarToUp,
  TbCornerDownRight,
  TbPencil,
  TbTrash,
} from "react-icons/tb";
import { ProfileName } from "../layout/Sidebar";
import { useOpenUserPreview } from "../../hooks/useOpenUserPreview";
import { useChatScroll } from "../../hooks/useChatScroll";
import { useMessageEditWindow } from "../../hooks/useMessageEditWindow";
import { Button, ConfirmDialog, EmptyState, IconButton, Input, Spinner } from "../ui";
import MessageByteCount from "../ui/MessageByteCount";
import ConversationIntro from "./ConversationIntro";
import { MAX_MESSAGE_BYTES, MAX_MESSAGE_INPUT_BYTES, MESSAGE_SIZE_ERROR, limitMessageInput, messageByteLength } from "../../utils/messageContent";
import { describeSystemMessage } from "../../utils/systemMessage";

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const MESSAGE_GROUP_GAP = 60 * 60 * 1000;

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long", day: "numeric", month: "short", year: "numeric",
});

function messageDate(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

// A sender change, calendar-day change or hour-long pause ends a visual run.
function sameMessageGroup(message, other) {
  const date = messageDate(message?.sent_at);
  const otherDate = messageDate(other?.sent_at);
  return Boolean(date && otherDate && message?.sender_id &&
    message.sender_id === other?.sender_id &&
    date.toDateString() === otherDate.toDateString() &&
    Math.abs(otherDate - date) < MESSAGE_GROUP_GAP);
}

const PanelCenter = styled.div`
  display: grid;
  flex: 1;
  place-items: center;
  color: var(--text-secondary);
`;

const RoomContentScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-4);
`;

const ConversationPane = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
`;

const HistoryStart = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: ${({ $active }) => $active ? "36px" : "1px"};
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
`;

const JumpButton = styled(IconButton)`
  position: absolute;
  ${({ $down }) => $down ? "bottom" : "top"}: var(--space-2);
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
  border-color: var(--border-strong);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
`;

const MessageList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`;

const DayDivider = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-3) 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-align: center;

  &::before,
  &::after {
    content: "";
    height: 1px;
    flex: 1;
    background: var(--border-strong);
  }
`;

const SystemLine = styled.p`
  align-self: center;
  max-width: min(90%, 640px);
  margin: var(--space-2) 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-align: center;
`;

const MessageItemWrap = styled.div`
  align-self: ${({ $isOwn }) => $isOwn ? "flex-start" : "flex-end"};
  width: fit-content;
  min-width: min(220px, 78%);
  max-width: min(78%, 640px);
  margin-top: ${({ $startsTurn }) => $startsTurn ? "var(--space-3)" : "0"};

  @media (max-width: 700px) {
    min-width: min(220px, 92%);
    max-width: 92%;
  }
`;

const MessageItemRoot = styled.article`
  position: relative;
  display: flex;
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  ${({ $isOwn }) => $isOwn ? "border-top-left-radius" : "border-top-right-radius"}: 0;
  background: ${({ $isOwn }) => $isOwn ? "var(--accent-soft)" : "var(--bg-elevated)"};

  &::before {
    content: "";
    position: absolute;
    top: 0;
    ${({ $isOwn }) => $isOwn ? "left" : "right"}: -8px;
    width: 8px;
    height: 12px;
    background: inherit;
    clip-path: ${({ $isOwn }) => $isOwn
      ? "polygon(100% 0, 0 0, 100% 100%)"
      : "polygon(0 0, 100% 0, 0 100%)"};
    pointer-events: none;
  }

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid var(--border-strong);
    border-radius: inherit;
    /* Leave the tail's join open instead of drawing a line across it. */
    clip-path: ${({ $isOwn }) => $isOwn
      ? "polygon(1px 0, 100% 0, 100% 100%, 0 100%, 0 12px, 1px 12px)"
      : "polygon(0 0, calc(100% - 1px) 0, calc(100% - 1px) 12px, 100% 12px, 100% 100%, 0 100%)"};
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease);
    pointer-events: none;
  }

  &:hover::after,
  &:focus-within::after {
    opacity: 1;
  }
`;

const BubbleTailOutline = styled.svg`
  position: absolute;
  top: 0;
  ${({ $isOwn }) => $isOwn ? "left" : "right"}: -8px;
  width: 8px;
  height: 12px;
  overflow: visible;
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 1px;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
  pointer-events: none;

  ${MessageItemRoot}:hover &,
  ${MessageItemRoot}:focus-within & {
    opacity: 1;
  }
`;

/**
 * Hidden with opacity, not display: none — the buttons stay in the tab order,
 * and visible keyboard focus reveals them without sticky touch focus.
 */
const MessageActions = styled.div`
  position: absolute;
  top: -26px;
  right: 6px;
  z-index: 2;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  opacity: ${({ $revealed }) => $revealed ? 1 : 0};
  pointer-events: ${({ $revealed }) => $revealed ? "auto" : "none"};
  transition: opacity var(--dur) var(--ease);

  ${({ $timed }) => !$timed && css`
    ${MessageItemRoot}:hover & {
      opacity: 1;
      pointer-events: auto;
    }
  `}

  ${MessageItemRoot}:focus-visible &,
  ${MessageItemRoot}:has(:focus-visible) & {
    opacity: 1;
    pointer-events: auto;
  }
`;

const MessageBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
`;

const MessageMeta = styled.div`
  display: flex;
  min-width: 0;

  ${ProfileName} {
    min-width: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: 1.35;
    overflow-wrap: anywhere;

    &:hover {
      color: var(--accent-400);
    }
  }
`;

const MessageTimestamp = styled.time`
  display: block;
  margin: var(--space-1) 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: 1.4;
  text-align: ${({ $isOwn }) => $isOwn ? "left" : "right"};

  ${({ $temporary }) => $temporary && css`
    max-height: 0;
    margin-top: 0;
    overflow: hidden;
    opacity: 0;
    visibility: hidden;
    /* Fade after the click's hold timer, then close the space below the bubble. */
    transition:
      opacity var(--dur) var(--ease),
      max-height 0s 200ms,
      margin-top 0s 200ms,
      visibility 0s 200ms;

    ${({ $revealed }) => $revealed && css`
      max-height: 2em;
      margin-top: var(--space-1);
      opacity: 1;
      visibility: visible;
      transition-delay: 0s;
    `}
  `}
`;

const MessageContent = styled.p`
  margin: 0;
  line-height: 1.5;
  color: var(--text-primary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;

  /* The "(edited)" marker is metadata, so it matches the timestamp. */
  small {
    color: var(--text-tertiary);
  }
`;

const ReplyQuote = styled.button`
  display: flex;
  gap: var(--space-2);
  align-items: center;
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: var(--space-2) 10px;
  border: 0;
  border-left: 2px solid var(--accent-400);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.5;
  text-align: left;
  cursor: pointer;

  span {
    display: block;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  strong {
    display: block;
    overflow: hidden;
    color: var(--accent-400);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  svg {
    flex-shrink: 0;
  }

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-left-color: var(--accent-400);
  }
`;

const EditForm = styled.form`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin-top: var(--space-1);

  input {
    flex: 1 1 120px;
    min-width: 0;
  }
`;

const EditHint = styled.small`
  display: block;
  margin-top: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
`;

function RoomContent({
  roomChat,
  state,
  roomName,
  roomDescription,
  isDm,
  peer,
  messagesById,
  currentUserId,
  hasOlder,
  loadingOlder,
  olderError,
  onLoadOlder,
  onReply,
  onEdit,
  canModerate,
  onDelete,
}) {
  const [editingId, setEditingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const { scrollRef, contentRef, topRef, onScroll, scrollToTop, scrollToBottom, scrollToMessage, jumpDirection } =
    useChatScroll(roomChat, state, currentUserId, { hasOlder, loadingOlder, olderError, onLoadOlder });

  const jumpToReply = (messageId) => {
    if (!scrollToMessage(messageId)) {
      toast.error("That message isn't loaded yet. Scroll up to load older messages.");
    }
  };

  const closeDelete = () => {
    setPendingDelete(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete?.(pendingDelete.id);
      toast.success("Message deleted.");
      setPendingDelete(null);
    } catch (failure) {
      toast.error(failure?.message || "Couldn't delete this message.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {state === "loading" && (
        <PanelCenter>
          <Spinner $size={24} aria-label="Loading chat" />
        </PanelCenter>
      )}

      {state === "success" && (
        <ConversationPane>
          <RoomContentScroll ref={scrollRef} onScroll={onScroll} role="region" aria-label="Messages">
            <MessageList ref={contentRef}>
              <HistoryStart ref={topRef} $active={hasOlder || loadingOlder || Boolean(olderError)}>
                {loadingOlder ? (
                  <Spinner $size={20} role="status" aria-label="Loading older messages" />
                ) : olderError ? (
                  <Button
                    type="button"
                    $variant="ghost"
                    $size="sm"
                    onClick={onLoadOlder}
                    title={olderError}
                  >
                    Couldn't load older messages. Retry
                  </Button>
                ) : null}
              </HistoryStart>
              {!hasOlder && !loadingOlder && !olderError && (
                <ConversationIntro
                  roomName={roomName}
                  roomDescription={roomDescription}
                  isDm={isDm}
                  peer={peer}
                  isEmpty={roomChat.length === 0}
                />
              )}
              {roomChat.map((message, index) => {
                const isOwn = Boolean(currentUserId) && message.sender_id === currentUserId;
                const date = messageDate(message.sent_at);
                const previousMessage = roomChat[index - 1];
                const previousDate = messageDate(previousMessage?.sent_at);
                // Compare local calendar days, matching the displayed timestamps.
                // Deriving from the full list also joins days across page boundaries.
                const showDay = date && date.toDateString() !== previousDate?.toDateString();
                const startsTurn = Boolean(previousMessage) && !showDay && !sameMessageGroup(previousMessage, message);
                const showTimestamp = !sameMessageGroup(message, roomChat[index + 1]);
                return (
                  <Fragment key={message.id}>
                    {showDay && (
                      <DayDivider>
                        <time dateTime={message.sent_at}>{dayFormatter.format(date)}</time>
                      </DayDivider>
                    )}
                    {message.content_type === "system" ? (
                      <SystemLine>
                        {describeSystemMessage(message.system, currentUserId)}
                        {date && (
                          <> · <time dateTime={message.sent_at}>{timeFormatter.format(date)}</time></>
                        )}
                      </SystemLine>
                    ) : (<MessageItem
                      message={message}
                      repliedTo={message.reply_to_id ? messagesById?.get(message.reply_to_id) : null}
                      isOwn={isOwn}
                      startsTurn={startsTurn}
                      showTimestamp={showTimestamp}
                      canDelete={isOwn || Boolean(canModerate)}
                      isEditing={editingId === message.id}
                      onStartEdit={() => setEditingId(message.id)}
                      onStopEdit={() => setEditingId(null)}
                      onReply={onReply}
                      onJumpToReply={jumpToReply}
                      onEdit={onEdit}
                      onStartDelete={() => setPendingDelete(message)}
                    />
                    )}
                  </Fragment>
                );
              })}
            </MessageList>
          </RoomContentScroll>
          {jumpDirection && roomChat.length > 0 && (
            <JumpButton
              type="button"
              $round
              $size={30}
              $down={jumpDirection === "down"}
              onClick={jumpDirection === "down" ? scrollToBottom : scrollToTop}
              aria-label={jumpDirection === "down" ? "Jump to latest messages" : "Jump to top of loaded messages"}
              title={jumpDirection === "down" ? "Jump to latest messages" : "Jump to top of loaded messages"}
            >
              {jumpDirection === "down" ? <TbArrowBarToDown size={17} /> : <TbArrowBarToUp size={17} />}
            </JumpButton>
          )}
        </ConversationPane>
      )}

      {state === "error" && (
        <PanelCenter>
          <EmptyState
            icon={TbAlertTriangle}
            title="Error loading chat."
            hint="Something went wrong fetching these messages."
          />
        </PanelCenter>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete message?"
        text={
          pendingDelete && pendingDelete.sender_id !== currentUserId
            ? `Delete this message from ${pendingDelete.sender_username ?? "this user"}? Everyone in the room will see it as deleted.`
            : "Everyone in the room will see it as deleted."
        }
        confirmLabel="Delete"
        busyLabel="Deleting..."
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={closeDelete}
      />
    </>
  );
}

function MessageItem({
  message,
  repliedTo,
  isOwn,
  startsTurn,
  showTimestamp,
  canDelete,
  isEditing,
  onStartEdit,
  onStopEdit,
  onReply,
  onJumpToReply,
  onEdit,
  onStartDelete,
}) {
  const openPreview = useOpenUserPreview();
  const sender = { id: message.sender_id, username: message.sender_username };
  const canPreview = Boolean(sender.id);
  const canAct = !message.deleted;
  const canEdit = useMessageEditWindow(message.sent_at, isOwn && canAct);
  const sentAt = messageDate(message.sent_at);
  // null keeps normal mouse-hover behavior; true/false track a timed reveal.
  const [detailsRevealed, setDetailsRevealed] = useState(null);
  const detailsTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(detailsTimer.current), []);

  const revealDetails = (event) => {
    if (isEditing ||
      event.target.closest("button, a, input, textarea, select, form")) return;
    window.clearTimeout(detailsTimer.current);
    setDetailsRevealed(true);
    detailsTimer.current = window.setTimeout(() => setDetailsRevealed(false), 2000);
  };

  return (
    <MessageItemWrap $isOwn={isOwn} $startsTurn={startsTurn}>
      <MessageItemRoot
        id={`message-${message.id}`}
        data-message-id={message.id}
        $isOwn={isOwn}
        tabIndex={!isEditing && (canAct || (!showTimestamp && sentAt)) ? 0 : undefined}
        onClick={revealDetails}
        onMouseEnter={() => {
          if (detailsRevealed === false) setDetailsRevealed(null);
        }}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            revealDetails(event);
          }
        }}
      >
        <MessageBody>
          {!isOwn && (
            <MessageMeta>
              <ProfileName
                onClick={canPreview ? openPreview(sender) : undefined}
                style={canPreview ? { cursor: "pointer" } : undefined}
              >
                {message.sender_username ?? "Unknown user"}
              </ProfileName>
            </MessageMeta>
          )}

          {message.reply_to_id && (
            <ReplyQuote
              type="button"
              onClick={() => onJumpToReply(message.reply_to_id)}
              title="Jump to the replied-to message"
            >
              <TbCornerDownRight size={16} aria-hidden="true" />
              <span>
                <strong>{repliedTo?.sender_username ?? "Unknown user"}</strong>
                <span>{replyPreview(repliedTo)}</span>
              </span>
            </ReplyQuote>
          )}

          {isEditing ? (
            <MessageEditor message={message} onSave={onEdit} onClose={onStopEdit} />
          ) : (
            <MessageContent>
              {message.deleted ? <em>Message deleted</em> : message.content}
              {message.edited_at && !message.deleted && <small> (edited)</small>}
            </MessageContent>
          )}
        </MessageBody>
        <BubbleTailOutline $isOwn={isOwn} viewBox="0 0 8 12" aria-hidden="true" focusable="false">
          <path d={isOwn ? "M9 0.5 H1 L8.5 12" : "M-1 0.5 H7 L-0.5 12"} />
        </BubbleTailOutline>
        {canAct && !isEditing && (
          <MessageActions $revealed={detailsRevealed === true} $timed={detailsRevealed !== null}>
            <IconButton
              type="button"
              $size={28}
              onClick={() => onReply?.(message)}
              aria-label="Reply to this message"
              title="Reply"
            >
              <TbArrowBackUp size={16} />
            </IconButton>

            {canEdit && (
              <IconButton
                type="button"
                $size={28}
                onClick={onStartEdit}
                aria-label="Edit this message"
                title="Edit"
              >
                <TbPencil size={16} />
              </IconButton>
            )}

            {canDelete && (
              <IconButton
                type="button"
                $size={28}
                onClick={onStartDelete}
                aria-label="Delete this message"
                title="Delete"
              >
                <TbTrash size={16} />
              </IconButton>
            )}
          </MessageActions>
        )}
      </MessageItemRoot>
      {sentAt && (
        <MessageTimestamp
          $isOwn={isOwn}
          $temporary={!showTimestamp}
          $revealed={detailsRevealed === true}
          dateTime={message.sent_at}
          title={sentAt.toLocaleString()}
        >
          {timeFormatter.format(sentAt)}
        </MessageTimestamp>
      )}
    </MessageItemWrap>
  );
}

/** The quoted line. The target may be deleted, or older than the loaded page. */
function replyPreview(repliedTo) {
  if (!repliedTo) return "Original message";
  if (repliedTo.deleted) return "Replying to a deleted message";

  return repliedTo.content ?? "";
}

/**
 * Inline edit. Keep the draft on failure and report the reason in a toast.
 */
function MessageEditor({ message, onSave, onClose }) {
  const [text, setText] = useState(message.content ?? "");
  const countId = useId();
  const bytes = messageByteLength(text);
  const overLimit = bytes > MAX_MESSAGE_BYTES;
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmed = text.trim();
    if (!trimmed || saving) return;
    if (overLimit) {
      toast.error(MESSAGE_SIZE_ERROR);
      return;
    }
    if (trimmed === message.content) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await onSave?.(message.id, trimmed);
      toast.success("Message updated.");
      onClose();
    } catch (failure) {
      toast.error(failure?.message || "Couldn't edit this message.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <EditForm onSubmit={handleSubmit}>
        <Input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(event) => setText(limitMessageInput(event.target.value))}
          maxLength={MAX_MESSAGE_INPUT_BYTES}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
          aria-label="Edit message"
          aria-describedby={countId}
          aria-invalid={overLimit}
          $invalid={overLimit}
          disabled={saving}
        />
        <Button type="submit" $pill $size="sm" disabled={saving || !text.trim() || overLimit}>
          Save
        </Button>
        <Button type="button" $pill $size="sm" $variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </EditForm>

      <MessageByteCount id={countId} bytes={bytes} />
      <EditHint>Escape to cancel</EditHint>
    </>
  );
}

export default RoomContent;
