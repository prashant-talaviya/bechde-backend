# Unread chat updates

Unread badges use an authenticated WebSocket at `/api/events`; the former five-second unread polling timer has been removed.

The app fetches `/api/conversations/unread` once at login/session restore, after connecting or reconnecting the socket, on return to the foreground, and when it receives `unread.changed`. A short debounce coalesces bursts. Message sends notify the receiving user's connected devices; marking messages read notifies the reading user's devices. An idle connected app makes no periodic unread HTTP requests. HTTP 304 means the unread response has not changed; it is not an error.

Connections close in the background and on logout. Foreground connections retry with exponential backoff, capped at 60 seconds. The server validates the access JWT and account status during the upgrade, closes the socket at token expiry, and uses protocol ping/pong to clean up broken connections. Credentials use the WebSocket upgrade header rather than query strings.

Restart the backend after installing the `ws` dependency and reload the app. The normal API URL determines `ws://` or `wss://` automatically. A reverse proxy must forward WebSocket Upgrade/Connection headers for `/api/events` to the same backend port.

The event broadcaster currently runs inside one backend process. If the API is scaled across processes or servers, connect the broadcasters through a shared pub/sub service before relying on cross-instance delivery. A reconnect still fetches the authoritative unread snapshot. The message-history screen's existing polling is separate from unread badges.
