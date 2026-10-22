import { useId, useState } from "react";
import styled from "styled-components";
import { updateRoom } from "../../api/rooms";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import {
  MAX_ROOM_NAME_LENGTH,
  MAX_ROOM_DESCRIPTION_LENGTH,
  validateRoomDetails,
} from "../../utils/roomValidation";
import { Button, Input, InlineError, TextArea } from "../ui";
import { useToast } from "../ui/ToastProvider";

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
`;

const Dialog = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: min(92vw, 420px);
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);

  h3 {
    margin: 0;
    font-size: var(--text-lg);
  }
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--text-sm);
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
`;

function RoomDetailsDialog({ room, mode, onUpdated, onClose }) {
  const renaming = mode === "rename";
  const [value, setValue] = useState(renaming ? room.name : room.description ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const titleId = useId();
  const errorId = useId();
  const name = renaming ? value.trim() : room.name;
  const description = renaming ? undefined : value;
  const error = validateRoomDetails(renaming ? value : name, description);
  const unchanged = renaming
    ? name === room.name
    : value === (room.description ?? "");

  const close = () => {
    if (!busy) onClose();
  };
  useEscapeKey(close);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || error || unchanged) return;
    setBusy(true);
    try {
      const updated = await updateRoom(room.id, name, description);
      onUpdated(updated);
      toast.success(renaming ? "Room renamed." : "Room description updated.");
      onClose();
    } catch (err) {
      toast.error(err?.message || "Failed to update room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Backdrop onClick={close}>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
        onSubmit={handleSubmit}
      >
        <h3 id={titleId}>{renaming ? "Rename room" : "Edit description"}</h3>
        <Field>
          {renaming ? "Room name" : `Description for #${room.name}`}
          {renaming ? (
            <Input
              autoFocus
              required
              value={value}
              maxLength={MAX_ROOM_NAME_LENGTH}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
            />
          ) : (
            <TextArea
              autoFocus
              value={value}
              maxLength={MAX_ROOM_DESCRIPTION_LENGTH}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
            />
          )}
          <span>{value.length}/{renaming ? MAX_ROOM_NAME_LENGTH : MAX_ROOM_DESCRIPTION_LENGTH}</span>
        </Field>
        {error && <InlineError id={errorId}>{error}</InlineError>}
        <Actions>
          <Button type="button" $variant="secondary" $size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" $size="sm" disabled={busy || Boolean(error) || unchanged}>
            {busy ? "Saving..." : "Save"}
          </Button>
        </Actions>
      </Dialog>
    </Backdrop>
  );
}

export default RoomDetailsDialog;
