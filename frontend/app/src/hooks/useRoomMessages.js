import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteMessage,
  editMessage,
  listMessages,
  onConnectionStatus,
  sendMessage,
  subscribeToRoom,
} from "../api/messages";

/**
 * One room's messages: REST history on mount, the shared chat socket for
 * anything that happens afterwards (new, edited, deleted). Our own sends are
 * appended from the POST response and arrive again as message.new; both paths
 * dedupe by id. `state` mirrors the "loading" | "success" | "error" convention
 * the views already use.
 */
export function useRoomMessages(roomId) {
  const [messages, setMessages] = useState([]);
  const [state, setState] = useState("loading");
  const [connection, setConnection] = useState("connecting");
  const [sending, setSending] = useState(false);

  const appendMessage = useCallback((message) => {
    if (!message?.id) return;
    setMessages((previous) =>
      previous.some((item) => item.id === message.id) ? previous : [...previous, message],
    );
  }, []);

  /**
   * Shared by the socket's message.edited frame and by our own PATCH response:
   * whichever lands first wins, and the other is a no-op (same id, same text).
   */
  const applyEdit = useCallback((id, content, editedAt) => {
    setMessages((previous) =>
      previous.map((item) => (item.id === id ? { ...item, content, edited_at: editedAt } : item)),
    );
  }, []);

  /** Same idea for deletes: our own DELETE and the message.deleted frame both land here. */
  const applyDelete = useCallback((id) => {
    setMessages((previous) =>
      previous.map((item) => (item.id === id ? { ...item, content: null, deleted: true } : item)),
    );
  }, []);

  const applyUpdate = useCallback(
    (update) => {
      switch (update.type) {
        case "new":
          appendMessage(update.message);
          break;
        case "edited":
          applyEdit(update.id, update.content, update.edited_at);
          break;
        case "deleted":
          applyDelete(update.id);
          break;
        default:
          break;
      }
    },
    [appendMessage, applyEdit, applyDelete],
  );

  useEffect(() => onConnectionStatus(setConnection), []);

  useEffect(() => {
    if (!roomId) return undefined;

    let cancelled = false;
    setState("loading");
    setMessages([]);

    // Subscribe first so nothing sent while history loads is lost; the merge
    // below keeps anything that arrived live and dedupes by id.
    const unsubscribe = subscribeToRoom(roomId, applyUpdate);

    listMessages(roomId)
      .then((history) => {
        if (cancelled) return;
        setMessages((live) => {
          const known = new Set(history.map((item) => item.id));
          return [...history, ...live.filter((item) => !known.has(item.id))];
        });
        setState("success");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [roomId, applyUpdate]);

  const send = useCallback(
    async (content, replyToId) => {
      const text = (content || "").trim();
      if (!text) return;

      setSending(true);
      try {
        appendMessage(await sendMessage(roomId, text, replyToId));
      } finally {
        setSending(false);
      }
    },
    [roomId, appendMessage],
  );

  /**
   * Throws on refusal (EDIT_WINDOW_EXPIRED, NOT_SENDER) so the row can show
   * why: swallowing it here would leave the old text on screen with no reason.
   */
  const edit = useCallback(
    async (messageId, content) => {
      const text = (content || "").trim();
      if (!text) return;

      const saved = await editMessage(messageId, text);
      applyEdit(saved.id, saved.content, saved.edited_at);
    },
    [applyEdit],
  );

  /**
   * Sender, or a room owner/admin. Throws on refusal (NOT_ALLOWED) so the
   * confirm dialog can show why. Deleting twice is a 204 both times.
   */
  const remove = useCallback(
    async (messageId) => {
      await deleteMessage(messageId);
      applyDelete(messageId);
    },
    [applyDelete],
  );

  /** Reply targets are looked up in the loaded page; nothing is refetched. */
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );

  return { messages, messagesById, state, connection, sending, send, edit, remove };
}
