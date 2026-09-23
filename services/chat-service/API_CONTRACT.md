# chat-service API Contract

**Status (2026-09-19): no public endpoints yet.**

chat-service is being rebuilt from scratch against the v1 specification
(`chat-app-v1-spec-3.pdf`, §4). The previous MongoDB implementation (and its
`/api/rooms`, `/api/rooms/dm`, `/api/rooms/group`, `/api/rooms/{id}/messages`
contract) has been **removed**. Do not integrate against it.

Rooms, DMs and membership now belong to **org-service**, not chat-service.

## What exists today

| Method | Path | Notes |
|---|---|---|
| GET | `/actuator/health` | Internal liveness probe (docker-compose healthcheck). Not routed by the gateway. |

## What is planned (spec §4.3 / §4.5 — not implemented)

REST: `GET/POST /rooms/:id/messages`, `GET/PATCH/DELETE /messages/:id`.
WebSocket: one connection at `/ws/chat`; client events `subscribe`,
`unsubscribe`; server events `message.new`, `message.edited`,
`message.deleted`, `presence` (deferred). `typing` was removed from scope on 2026-09-22.

Gateway paths, the WebSocket envelope shape and JSON casing are still open team
decisions. This file will describe each endpoint only once it is implemented
and tested.
