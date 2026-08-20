# Research Notes — Profile Switch Session Behavior

## Current upstream behavior

- Explicit profile selection runs through `selectProfile()`.
- On a real profile change it calls `requestFreshSession()` and then `ensureGatewayProfile(target)`.
- This is the native `fresh_draft` route and must remain the default.

## Existing reusable capabilities

- `getRememberedSessionId()` and `setRememberedSessionId()` already persist a stored/lineage session ID per **connection plus profile**.
- `sessionBelongsToProfile()` already validates a remembered ID against loaded session ownership.
- `sessionRoute()` and the route-resume flow already open a stored session safely.
- The Desktop integrations owner already handles cold-start remembered navigation, waits for session data before validation, and clears stale remembered memory.
- The Desktop storage utility already persists client-local renderer preferences.

## Why this feature should be client-local

Profile-switch focus changes local renderer navigation, not backend data or profile configuration. A backend config value would unexpectedly couple different desktop clients attached to the same backend. A local setting is aligned with existing Desktop UI preferences and avoids any server RPC/schema/config migration.

## Rejected approaches

1. **Reintroduce the previous standalone foreground-restore hook.** Rejected because it duplicated the Desktop integration navigation owner and raced profile/session refresh.
2. **Restore arbitrary remembered routes.** Rejected because the requested behavior is intentionally smaller: restore the last viewed session only.
3. **Use raw runtime session IDs.** Rejected because runtime IDs are transient and do not survive persistence/compression.
4. **Change backend routing or WebSocket scope.** Rejected because profile switching focus is a renderer concern; current connection/profile isolation remains untouched.

## Upstream compatibility

- Open PR #73992 addresses stale project-scope follow behavior, not profile session focus.
- Open PR #90834 addresses remote SSH backend ownership, not session focus.
- Open PR #90832 addresses pinned state hydration after reconnect, not switch behavior.
- Open PR #90821 addresses per-profile loop state, not switch behavior.

None supersedes this proposed feature. Re-run this check immediately before implementation and again before any public PR.
