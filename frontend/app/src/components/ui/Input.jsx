import { forwardRef, useId } from "react";
import styled, { css } from "styled-components";

const fieldStyles = css`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid
    ${({ $invalid }) => ($invalid ? "var(--danger)" : "var(--border-strong)")};
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);

  &::placeholder {
    color: var(--text-tertiary);
  }

  &:hover:not(:disabled) {
    border-color: var(--text-tertiary);
  }

  &:focus {
    outline: none;
    border-color: var(--accent-500);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const StyledInput = styled.input`
  ${fieldStyles}
`;

const StyledTextArea = styled.textarea`
  ${fieldStyles}
  resize: vertical;
  min-height: 84px;
  line-height: 1.5;
`;

/**
 * Falls back to a generated id so fields always satisfy the browser's
 * "form field should have an id or name" autofill hint. Autocomplete is off
 * unless a field asks for it: past entries are noise in chat, search and
 * profile fields, and the auth forms pass their own tokens to keep it.
 */
const Input = forwardRef(function Input({ id, ...props }, ref) {
  const fallbackId = useId();
  return <StyledInput ref={ref} id={id ?? fallbackId} autoComplete="off" {...props} />;
});

export const TextArea = forwardRef(function TextArea({ id, ...props }, ref) {
  const fallbackId = useId();
  return <StyledTextArea ref={ref} id={id ?? fallbackId} autoComplete="off" {...props} />;
});

export default Input;
