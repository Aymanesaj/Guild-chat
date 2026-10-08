# AppShell Technical Walkthrough

## 1. Read in this order

```text
src/App.jsx                         session restore; protects /app/*
components/layout/AppShell.jsx      authenticated root and shared state
├── layout/Sidebar.jsx              group-room navigation
└── layout/MainPanel.jsx            selects DmView or RoomView
    ├── dms/DmView.jsx              DM conversation index
    └── rooms/RoomView.jsx          one DM/group conversation
hooks/useRoomMessages.js            REST history + socket updates
api/messages.js                     shared WebSocket + message REST
api/rooms.js                        rooms, DMs, members and roles
hooks/usePresence.js                presence WebSocket subscriptions
```

## 2. AppShell

**File:** `components/layout/AppShell.jsx`

```text
AppShell
└── ProfileOverlayProvider
    └── AppShellContent
        ├── NavDrawerProvider + RoomNavigationProvider
        ├── Sidebar
        ├── MainPanel -> DmView | RoomView
        └── ProfileOverlay + ProfilePreviewPopover
```

### View and room-list state

```jsx
const [isDirectMessages, setIsDirectMessages] = useState(true);
const [activeRoomId, setActiveRoomId] = useState(null); // room object, not only id
const [rooms, setRooms] = useState([]);                 // group rooms only
const [roomsState, setRoomsState] = useState("loading");
const [isNavOpen, setIsNavOpen] = useState(false);
const mutationSeq = useRef(0);
```

```jsx
const handleRoomChange = useCallback((room) => {
  setActiveRoomId(room); setIsDirectMessages(false); setIsNavOpen(false);
}, []);
const handleDirectMessages = useCallback(() => {
  setIsDirectMessages(true); setIsNavOpen(false);
}, []);
```

### Group-room REST load

```jsx
const loadRooms = useCallback(async () => {
  const seq = mutationSeq.current;
  const data = await getRooms();                    // GET /api/orgs/rooms
  if (seq !== mutationSeq.current) return;          // stale request
  setRooms(data); setRoomsState("success");
}, []);
useEffect(() => { mutationSeq.current += 1; loadRooms(); },
  [loadRooms, roomsRefreshTick]);
```

`roomsRefreshTick` changes after leaving a room. `mutationSeq` stops an older GET from undoing a newer create/leave.

### Session socket and room events

```jsx
useEffect(() => { connectChat(); }, []);
useEffect(() => onRoomEvent((event) => {
  if (event.type === "activity") return;
  mutationSeq.current += 1; loadRooms();
}), [loadRooms]);
```

| Event | AppShell action |
|---|---|
| `room.added`, `room.removed`, `room.updated` | Refetch group rooms |
| reconnect `resync` | Refetch missed changes |
| `room.activity` | Ignore; group rows show no previews |

After a successful refetch, if the open group is missing, AppShell returns to the DM home. This handles kicks/removals.

## 3. Sidebar

**Files:** `layout/Sidebar.jsx`, `CreateRoomInput.jsx`, `NavDrawerContext.jsx`, `ui/SlidePanel.jsx`

AppShell passes `rooms`, loading state, active room, navigation callbacks, room-created callback, and logout. Sidebar owns no list fetch and no socket listener.

```text
Sidebar
├── Direct Messages button
├── RoomsSection -> create form + feedback + RoomButton[]
├── ProfilePreview -> open current profile + logout
└── legal links
```

Create flow:

```jsx
const newRoom = await createRoom(name); // POST /api/orgs/rooms
onRoomCreated(newRoom);                 // prepend to AppShell rooms
onRoomChange(newRoom);                  // open it
```

`onRoomCreated` increments `mutationSeq`; an older list response cannot erase the new room.

Responsive behavior uses `PHONE_QUERY = "(max-width: 700px)"`: inline column on desktop, left drawer on phone. The same wrapper stays mounted across breakpoint changes, preserving sidebar state. Navigation closes the drawer.

## 4. MainPanel

**File:** `layout/MainPanel.jsx`

```jsx
if (activeView === true) return <DmView />;
const isDm = activeView.type === "dm";
const roomName = isDm ? activeView.peer?.username ?? "Direct message" : activeView.name;
return <RoomView roomId={activeView.id} roomName={roomName} isDm={isDm} />;
```

```text
true                   -> DM conversation list
{ type: "dm" }         -> RoomView without members/moderation
{ type: "group" }      -> RoomView with members/moderation
```

MainPanel has no state or requests; it only dispatches AppShell state to the correct branch.

## 5. DmView

**Files:** `dms/DmView.jsx`, `DmList.jsx`, `DmItem.jsx`, `FriendsSidebar.jsx`, `api/rooms.js`

### State and REST load

```jsx
const [rooms, setRooms] = useState([]);
const [loading, setLoading] = useState("loading");
const [isFriendsOpen, setFriendsOpen] = useState(false);
const knownRooms = useRef([]);       // rooms + current previews
const loadSeq = useRef(0);           // newest GET wins
const loadsInFlight = useRef(0);
const pendingActivity = useRef([]);  // events received during GET
```

On mount, `loadRooms()` calls `syncDmRooms(knownRooms.current)`:

```text
GET /api/orgs/rooms/dm
-> normalize rooms
-> resolve peers with /api/users/{id}
-> reuse known previews
-> GET /api/chat/rooms/last-messages for new DMs only
-> sortDmRooms() -> toConversation() -> DmItem[]
```

`DmItem` shows peer avatar/name, presence, last-message preview, and timestamp. Clicking calls `navigateToRoom(room)` from `RoomNavigationContext`, which reaches AppShell.

### Socket events

```jsx
useEffect(() => onRoomEvent((event) => {
  if (event.type === "activity") { /* apply/queue preview */ return; }
  if (["added", "removed", "resync"].includes(event.type)) loadRooms();
}), [loadRooms]);
```

| Event | DmView action |
|---|---|
| activity `new` | Replace preview; timestamp reorders list |
| activity `edited` | Update only if edited message is current preview |
| activity `deleted` | Show deleted marker only if it is current preview |
| `room.added`, `room.removed` | Refetch DM rooms |
| reconnect `resync` | Refetch missed changes |
| `room.updated` | Ignore; no membership data is shown here |

If REST and activity overlap, only the newest REST result is accepted and queued activity events are reapplied over it.

### Presence and friends

```jsx
const presence = usePresence(conversations.map((item) => item.userId));
```

`usePresence` watches visible user IDs with `presence.subscribe` on the shared chat socket. The server sends `presence.snapshot` initially and on reconnect, then `presence.changed` updates. There is no presence polling; `GET /api/chat/presence` remains available in the backend.

The hook returns a `Map<userId, "online" | "offline">`; users are unknown until
their snapshot arrives. It clears the map when the watched IDs change and removes
its listeners on cleanup. Overlapping views share subscriptions: closing one view
only unsubscribes users with no remaining listeners. Requests are batched into at
most 100 user IDs per frame. The backend counts tabs and devices together and
waits 5 seconds after the final socket closes before publishing `offline`.
See [Presence over the shared WebSocket](PRESENCE.md) for the complete flow.

`FriendsSidebar` loads `GET /api/users/friends`. Starting a chat runs `POST /api/orgs/rooms/dm`, then `navigateToRoom(returnedRoom)`.

## 6. RoomView

**Files:** `rooms/RoomView.jsx`, `RoomHeader.jsx`, `RoomContent.jsx`, `MessageComposer.jsx`, `MembersSidebar.jsx`

```jsx
const [membersPanel, setMembersPanel] = useState({ roomId, open: false });
const [reply, setReply] = useState({ roomId, message: null });
const [myRole, setMyRole] = useState({ roomId, role: null });
```

State is tagged with `roomId` because React reuses RoomView during switches. Old replies, role, and drawer state therefore cannot leak into the new room.

```text
RoomView
├── RoomHeader       room/peer title; phone nav; members toggle
├── RoomContent      message list; reply; edit; delete confirmation
├── MessageComposer  text input; reply banner; send
└── MembersSidebar   group only; mounted only while open
```

Groups call `getMyRoomRole(roomId)`. Owners/admins get moderator delete controls. DMs skip role/member logic.

```jsx
const { messages, messagesById, state, sending, send, edit, remove }
  = useRoomMessages(roomId);
```

### useRoomMessages workflow

**File:** `hooks/useRoomMessages.js`

```jsx
useEffect(() => {
  setState("loading"); setMessages([]);
  const unsubscribe = subscribeToRoom(roomId, applyUpdate); // subscribe first
  listMessages(roomId).then((history) => {                  // REST second
    setMessages((live) => {
      const ids = new Set(history.map((m) => m.id));
      return [...history, ...live.filter((m) => !ids.has(m.id))];
    });
    setState("success");
  });
  return unsubscribe;
}, [roomId, applyUpdate]);
```

```text
subscribe -> GET history -> receive possible live messages
-> merge/dedupe by id -> render -> unsubscribe on switch
```

Subscribing before history prevents losing messages sent while the GET is running.

| Update | React state operation |
|---|---|
| `new` | Append unless ID exists |
| `edited` | Replace matching content and `edited_at` |
| `deleted` | Set matching content to null and `deleted: true` |

Message mutations use REST:

```text
POST   /api/chat/rooms/{roomId}/messages  send
PATCH  /api/chat/messages/{messageId}     edit
DELETE /api/chat/messages/{messageId}     delete
```

REST updates the initiating client immediately; the socket broadcasts to all clients. The initiator's echoed event is deduplicated by message ID.

## 7. Shared WebSocket

**File:** `api/messages.js`

```jsx
const subscribers = new Map(); // roomId -> Set<handler>
const presenceSubscribers = new Map(); // userId -> Set<handler>
const roomListeners = new Set();
let socket = null;
let keepOpen = false;           // true while AppShell session exists
```

`subscribeToRoom(roomId, handler)` stores the handler, sends `subscribe`, ensures the socket exists, and returns cleanup. Cleanup removes the handler and sends `unsubscribe` when the room has no handlers. The socket itself remains open for AppShell events and presence.

`subscribeToPresence(userIds, handler)` uses that same socket and returns cleanup.
The handler receives `{ userId, status }` from both snapshot and change frames.
Each new listener requests a snapshot, including for users another view already
watches. The last listener for a user sends `presence.unsubscribe` on cleanup.

| Frame | Dispatch |
|---|---|
| `message.new` | Resolve sender, normalize, dispatch `new` to room |
| `message.edited` | Dispatch `edited` to room |
| `message.deleted` | Dispatch `deleted` to room |
| `room.added/removed/updated` | Notify global room listeners |
| `room.activity` | Send preview update to DmView |
| `presence.snapshot` | Dispatch each returned status to that user's presence listeners |
| `presence.changed` | Dispatch the changed user's status to their presence listeners |
| `error` | Debug log; keep socket alive |

Connection lifecycle:

```text
/ws/chat?token={accessToken}
-> refresh near-expired token before connect
-> on open, resubscribe every room and watched user; presence subscriptions return fresh snapshots
-> unexpected close: refresh session; retry 1s, 2s, 4s, 8s, max 15s
-> reconnect: emit resync so lists refetch
-> logout: clear listeners/subscriptions; close without reconnect
```

Callbacks from an older socket are ignored, so a late snapshot cannot overwrite
the current connection's presence state. While disconnected, the hook keeps its
last known statuses until the new snapshot arrives.

## 8. MembersSidebar and supporting state

**Members files:** `MembersSidebar.jsx`, `MemberList.jsx`, `MemberItem.jsx`, `MemberActionsMenu.jsx`

On open: `getRoomMembers(roomId)`. `room.updated` for that room or reconnect `resync` quietly refetches members. `usePresence(memberIds)` subscribes to snapshots and live presence changes over the same socket.

```text
POST   /api/orgs/rooms/{roomId}/members                 add
DELETE /api/orgs/rooms/{roomId}/members/{userId}        kick
PATCH  /api/orgs/rooms/{roomId}/members/{userId}/roles  promote/demote
owner: promote/demote/kick | admin: kick members | member: no actions
```

| Context/hook | Responsibility |
|---|---|
| `ProfileOverlayContext` | Current user, overlays, room-refresh notification |
| `RoomNavigationContext` | Nested component -> AppShell room navigation |
| `NavDrawerContext` | Phone breakpoint and left drawer state |
| `useRoomMessages` | Room history, subscription, mutation state |
| `usePresence` | WebSocket snapshot + live changes; resubscribe on reconnect |
| `useAvatarUrl` | Protected avatar fetch and object-URL cache |

## 9. Whole flow

```text
AppShell -> GET group rooms -> Sidebar
room event -> AppShell refetch -> Sidebar rerender

DmView -> GET DMs/peers/previews -> DmItem[]
room.activity -> update preview -> reorder DMs
presence.subscribe -> presence.snapshot / presence.changed -> update dots

RoomView -> subscribe room -> GET history -> merge/dedupe
send/edit/delete -> REST -> immediate local update
message frame -> update subscribed clients
room switch -> unsubscribe old -> subscribe new
```
