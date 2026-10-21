import styled from "styled-components";
import { MAX_MESSAGE_BYTES } from "../../utils/messageContent";

export default function MessageByteCount({ bytes, ...props }) {
  const overLimit = bytes > MAX_MESSAGE_BYTES;
  return (
    <Count $overLimit={overLimit} {...props}>
      {bytes.toLocaleString("en-US")} / {MAX_MESSAGE_BYTES.toLocaleString("en-US")}
    </Count>
  );
}

const Count = styled.small`
  display: block;
  font-size: var(--text-xs);
  color: ${({ $overLimit }) => $overLimit ? "var(--danger)" : "var(--text-tertiary)"};
`;
