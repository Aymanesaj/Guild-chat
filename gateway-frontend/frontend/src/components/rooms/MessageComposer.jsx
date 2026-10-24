import { useCallback, useEffect, useId, useRef, useState } from "react";
import styled from "styled-components";
import { useToast } from "../ui/ToastProvider";
import { TbArrowBackUp, TbPhoto, TbSend, TbX } from "react-icons/tb";
import { Button, IconButton, Input } from "../ui";
import MessageByteCount from "../ui/MessageByteCount";
import { MAX_MESSAGE_BYTES, MAX_MESSAGE_INPUT_BYTES, MESSAGE_SIZE_ERROR, limitMessageInput, messageByteLength } from "../../utils/messageContent";
import { IMAGE_TYPES, MAX_IMAGES, messagePreviewText, pickImages } from "../../utils/attachments";

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

const ImageTray = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-2) var(--space-4) 0;
  padding: 0;
  list-style: none;
`;

const ImageThumb = styled.li`
  position: relative;
  width: 64px;
  height: 64px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-surface);

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  button {
    position: absolute;
    top: 2px;
    right: 2px;
    background: var(--bg-elevated);
  }
`;

const ComposerField = styled.div`
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
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
  replyingTo, onCancelReply, focusEnabled = true, canAttach = false,
}) {
  const toast = useToast();
  const setToastAnchor = useCallback((element) => toast.setAnchor(element), [toast]);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const submitting = useRef(false);
  const countId = useId();
  const label = isDm ? `Message ${roomName}` : `Message #${roomName}`;
  const bytes = messageByteLength(text);
  const overLimit = bytes > MAX_MESSAGE_BYTES;
  // Picked, not uploaded yet: { file, url } where url is a local object URL for the thumbnail.
  const [images, setImages] = useState([]);
  const objectUrls = useRef(new Set());
  const canSend = Boolean(text.trim()) || images.length > 0;

  // The composer is remounted per room, so this frees every thumbnail left behind.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  function addImages(picked) {
    if (!canAttach || disabled) return;
    const { accepted, error } = pickImages(picked, images.length);
    if (error) toast.error(error);
    if (!accepted.length) return;

    const added = accepted.map((file) => {
      const url = URL.createObjectURL(file);
      objectUrls.current.add(url);
      return { file, url };
    });
    setImages((current) => [...current, ...added]);
  }

  function releaseImages(released) {
    released.forEach(({ url }) => {
      URL.revokeObjectURL(url);
      objectUrls.current.delete(url);
    });
    setImages((current) => current.filter((image) => !released.includes(image)));
  }

  // Covers opening a room, picking a reply and re-enabling the input after send.
  useEffect(() => {
    if (!disabled && focusEnabled) inputRef.current?.focus({ preventScroll: true });
  }, [roomId, disabled, replyingTo, focusEnabled]);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmed = text.trim();
    const sent = images;
    if ((!trimmed && !sent.length) || disabled || submitting.current) return;
    if (overLimit) {
      toast.error(MESSAGE_SIZE_ERROR);
      return;
    }

    submitting.current = true;
    try {
      await onSend(trimmed, replyingTo?.id, sent.map((image) => image.file));
      // A late response must not erase a newer draft written after revisiting this room.
      onTextChange((current) => current === text ? "" : current);
      releaseImages(sent);
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
            {messagePreviewText(replyingTo) ? ` — ${messagePreviewText(replyingTo)}` : ""}
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

      {images.length > 0 && (
        <ImageTray aria-label="Images to send">
          {images.map((image) => (
            <ImageThumb key={image.url}>
              <img src={image.url} alt={image.file.name} />
              <IconButton
                type="button"
                $size={22}
                $round
                onClick={() => releaseImages([image])}
                disabled={disabled}
                aria-label={`Remove ${image.file.name}`}
                title="Remove"
              >
                <TbX size={14} />
              </IconButton>
            </ImageThumb>
          ))}
        </ImageTray>
      )}

      <MessageComposerForm onSubmit={handleSubmit}>
        <ComposerField>
          {canAttach && (
            <>
              <IconButton
                type="button"
                $round
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || images.length >= MAX_IMAGES}
                aria-label="Attach images"
                title={images.length >= MAX_IMAGES ? `Up to ${MAX_IMAGES} images` : "Attach images"}
              >
                <TbPhoto size={18} />
              </IconButton>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_TYPES.join(",")}
                multiple
                hidden
                onChange={(event) => {
                  addImages([...event.target.files]);
                  event.target.value = ""; // picking the same file again still fires change
                }}
              />
            </>
          )}
          <ComposerInput
            ref={inputRef}
            type="text"
            value={text}
            onChange={(event) => onTextChange(limitMessageInput(event.target.value))}
            maxLength={MAX_MESSAGE_INPUT_BYTES}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelReply?.();
            }}
            onPaste={(event) => {
              const pasted = [...event.clipboardData.files];
              if (!canAttach || !pasted.length) return;
              event.preventDefault();
              addImages(pasted);
            }}
            placeholder={label}
            aria-label={label}
            aria-describedby={countId}
            aria-invalid={overLimit}
            $invalid={overLimit}
            autoFocus={focusEnabled}
            disabled={disabled}
          />
        </ComposerField>

        <SendButton type="submit" $pill disabled={disabled || !canSend || overLimit}>
          <TbSend size={18} />
          <span>Send</span>
        </SendButton>
        <ByteCount id={countId} bytes={bytes} />
      </MessageComposerForm>
    </MessageComposerRoot>
  );
}

export default MessageComposer;
