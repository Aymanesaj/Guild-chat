import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useToast } from "../ui/ToastProvider";
import {
  TbAlertTriangle,
  TbArrowBackUp,
  TbCornerDownRight,
  TbMessage2,
  TbPencil,
  TbTrash,
} from "react-icons/tb";
import { ProfileName } from "../layout/Sidebar";
import { formatTimestamp } from "../../api/rooms";
import { useOpenUserPreview } from "../../hooks/useOpenUserPreview";
import { Button, ConfirmDialog, EmptyState, IconButton, Input, Spinner } from "../ui";
import UserAvatar from "../profile/UserAvatar";

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

const MessageList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`;

const MessageItemRoot = styled.article`
  position: relative;
  display: flex;
  gap: 10px;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  transition: background var(--dur-fast) var(--ease);

  &:hover {
    background: var(--bg-surface);
  }
`;

/**
 * Hidden with opacity, not display: none — the buttons stay in the tab order,
 * and :focus-within reveals them for anyone navigating by keyboard.
 */
const MessageActions = styled.div`
  position: absolute;
  top: calc(var(--space-1) * -1);
  right: var(--space-2);
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);

  ${MessageItemRoot}:hover &,
  ${MessageItemRoot}:focus-within & {
    opacity: 1;
  }
`;

const MessageAvatarWrap = styled.div`
  flex: 0 0 36px;
  cursor: pointer;
`;

const MessageBody = styled.div`
  min-width: 0;
  flex: 1;
`;

const MessageMeta = styled.div`
  display: flex;
  gap: var(--space-2);
  align-items: baseline;

  time {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }
`;

const MessageContent = styled.p`
  margin: var(--space-1) 0 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;

  /* The "(edited)" marker is metadata, so it matches the timestamp. */
  small {
    color: var(--text-tertiary);
  }
`;

const ReplyQuote = styled.button`
  display: flex;
  gap: var(--space-1);
  align-items: center;
  max-width: 100%;
  margin-bottom: 2px;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;

  span {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &:hover span {
    color: var(--text-secondary);
  }
`;

const EditForm = styled.form`
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-top: var(--space-1);
`;

const EditHint = styled.small`
  display: block;
  margin-top: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
`;

/** Scrolls the quoted message into view; it may have scrolled out, or never loaded. */
function scrollToMessage(messageId) {
  document.getElementById(`message-${messageId}`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function RoomContent({
  roomChat,
  state,
  roomName,
  isDm,
  messagesById,
  currentUserId,
  onReply,
  onEdit,
  canModerate,
  onDelete,
}) {
  const [editingId, setEditingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

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
        <RoomContentScroll>
          {roomChat.length === 0 ? (
            <EmptyState
              icon={TbMessage2}
              title={isDm ? `Say hello to ${roomName}!` : `Say hello to #${roomName}!`}
              hint="No messages here yet — be the first to write one."
            />
          ) : (
            <MessageList>
              {roomChat.map((message) => {
                const isOwn = Boolean(currentUserId) && message.sender_id === currentUserId;
                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    repliedTo={message.reply_to_id ? messagesById?.get(message.reply_to_id) : null}
                    isOwn={isOwn}
                    canDelete={isOwn || Boolean(canModerate)}
                    isEditing={editingId === message.id}
                    onStartEdit={() => setEditingId(message.id)}
                    onStopEdit={() => setEditingId(null)}
                    onReply={onReply}
                    onEdit={onEdit}
                    onStartDelete={() => setPendingDelete(message)}
                  />
                );
              })}
            </MessageList>
          )}
        </RoomContentScroll>
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
  canDelete,
  isEditing,
  onStartEdit,
  onStopEdit,
  onReply,
  onEdit,
  onStartDelete,
}) {
  const openPreview = useOpenUserPreview();
  const sender = { id: message.sender_id, username: message.sender_username };
  const canPreview = Boolean(sender.id);
  const canAct = !message.deleted;

  return (
    <MessageItemRoot id={`message-${message.id}`}>
      <MessageAvatarWrap onClick={canPreview ? openPreview(sender) : undefined}>
        <UserAvatar avatar={message.sender_avatar} name={message.sender_username} $size={36} />
      </MessageAvatarWrap>

      <MessageBody>
        {message.reply_to_id && (
          <ReplyQuote
            type="button"
            onClick={() => scrollToMessage(message.reply_to_id)}
            title="Jump to the replied-to message"
          >
            <TbCornerDownRight size={12} />
            <span>{replyPreview(repliedTo)}</span>
          </ReplyQuote>
        )}

        <MessageMeta>
          <ProfileName
            onClick={canPreview ? openPreview(sender) : undefined}
            style={canPreview ? { cursor: "pointer" } : undefined}
          >
            {message.sender_username ?? "Unknown user"}
          </ProfileName>
          <time>{formatTimestamp(message.sent_at)}</time>
        </MessageMeta>

        {isEditing ? (
          <MessageEditor message={message} onSave={onEdit} onClose={onStopEdit} />
        ) : (
          <MessageContent>
            {message.deleted ? <em>Message deleted</em> : message.content}
            {message.edited_at && !message.deleted && <small> (edited)</small>}
          </MessageContent>
        )}
      </MessageBody>

      {canAct && !isEditing && (
        <MessageActions>
          <IconButton
            type="button"
            $size={28}
            onClick={() => onReply?.(message)}
            aria-label="Reply to this message"
            title="Reply"
          >
            <TbArrowBackUp size={16} />
          </IconButton>

          {isOwn && (
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
  );
}

/** The quoted line. The target may be deleted, or older than the loaded page. */
function replyPreview(repliedTo) {
  if (!repliedTo) return "Original message";
  if (repliedTo.deleted) return "Replying to a deleted message";

  const author = repliedTo.sender_username ?? "Unknown user";
  return `${author}: ${repliedTo.content ?? ""}`;
}

/**
 * Inline edit. Keep the draft on failure and report the reason in a toast.
 */
function MessageEditor({ message, onSave, onClose }) {
  const [text, setText] = useState(message.content ?? "");
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
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
          aria-label="Edit message"
          disabled={saving}
        />
        <Button type="submit" $pill $size="sm" disabled={saving || !text.trim()}>
          Save
        </Button>
        <Button type="button" $pill $size="sm" $variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </EditForm>

      <EditHint>Escape to cancel</EditHint>
    </>
  );
}

export default RoomContent;
