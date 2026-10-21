import styled from "styled-components";
import { MAX_MESSAGE_BYTES } from "../../utils/messageContent";

export default function MessageByteCount({ bytes, maxBytes = MAX_MESSAGE_BYTES, ...props }) {
  const overLimit = bytes > maxBytes;
  return (
    <Count $overLimit={overLimit} {...props}>
      {bytes.toLocaleString("en-US")} / {maxBytes.toLocaleString("en-US")}
    </Count>
  );
}

const Count = styled.small`
  display: block;
  font-size: var(--text-xs);
  color: ${({ $overLimit }) => $overLimit ? "var(--danger)" : "var(--text-tertiary)"};
`;
