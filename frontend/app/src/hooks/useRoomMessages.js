import { useCallback, useEffect, useState } from "react";
import { listMessages, onConnectionStatus, sendMessage, subscribeToRoom } from "../api/messages";

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

  const applyUpdate = useCallback(
    (update) => {
      switch (update.type) {
        case "new":
          appendMessage(update.message);
          break;
        case "edited":
          setMessages((previous) =>
            previous.map((item) =>
              item.id === update.id ? { ...item, content: update.content, edited_at: update.edited_at } : item,
            ),
          );
          break;
        case "deleted":
          setMessages((previous) =>
            previous.map((item) => (item.id === update.id ? { ...item, content: null, deleted: true } : item)),
          );
          break;
        default:
          break;
      }
    },
    [appendMessage],
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
    async (content) => {
      const text = (content || "").trim();
      if (!text) return;

      setSending(true);
      try {
        appendMessage(await sendMessage(roomId, text));
      } finally {
        setSending(false);
      }
    },
    [roomId, appendMessage],
  );

  return { messages, state, connection, sending, send };
}
