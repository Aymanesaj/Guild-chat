import { useState } from "react";
import styled from "styled-components";
import { TbCheck, TbX } from "react-icons/tb";
import { Button, Input, InlineError, TextArea } from "../ui";
import {
  MAX_ROOM_NAME_LENGTH,
  MAX_ROOM_DESCRIPTION_LENGTH,
  validateRoomDetails,
} from "../../utils/roomValidation";

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: var(--space-2) 0 10px;
  padding: 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);

  &:focus-within {
    border-color: var(--accent-500);
  }
`;

const NameInput = styled(Input)`
  min-width: 0;
  padding: 8px 10px;
  font-size: var(--text-sm);
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  color: var(--text-secondary);
  font-size: var(--text-xs);
`;

const DescriptionInput = styled(TextArea)`
  min-height: 72px;
  padding: 8px 10px;
  font-size: var(--text-sm);
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  width: 100%;
`;

function CreateRoomInput({ onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const error = validateRoomDetails(name, description);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (error || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), description);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={handleSubmit}>
      <Field>
        Room name ({name.length}/{MAX_ROOM_NAME_LENGTH})
        <NameInput
          autoFocus
          placeholder="Room name..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New room name"
          maxLength={MAX_ROOM_NAME_LENGTH}
          required
          disabled={busy}
        />
      </Field>
      <Field>
        Description (optional, {description.length}/{MAX_ROOM_DESCRIPTION_LENGTH})
        <DescriptionInput
          placeholder="What is this room about?"
          aria-label="New room description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={MAX_ROOM_DESCRIPTION_LENGTH}
          disabled={busy}
        />
      </Field>
      {name.length > 0 && error && <InlineError>{error}</InlineError>}

      <Actions>
        <Button
          type="button"
          $variant="ghost"
          $size="sm"
          onClick={onCancel}
          title="Cancel"
          disabled={busy}
          aria-label="Cancel room creation"
        >
          <TbX size={16} />
        </Button>

        <Button type="submit" $size="sm" disabled={Boolean(error) || busy} title="Create room" aria-label="Create room">
          <TbCheck size={16} />
        </Button>
      </Actions>
    </Form>
  );
}

export default CreateRoomInput;
