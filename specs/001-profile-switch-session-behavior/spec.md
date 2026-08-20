# Profile Switch Session Behavior

> Local SpecKit-style specification. Planning artifact only; not approved for publication.

## Problem Statement

Desktop profile switching currently always follows Hermes’ native fresh-draft behavior. That route is safe and must remain available, but it makes rapid switching between active profiles frustrating: returning to a profile loses the session context the user was just viewing.

The feature must offer an explicit Desktop setting that lets a user choose either the native behavior or a narrow restore-last-session behavior. The custom route must not replace gateway/profile routing, session ownership validation, connection isolation, or startup navigation.

## Goals

1. Add a Desktop Settings control for profile-switch behavior.
2. Preserve native Hermes behavior as the default and selectable route.
3. Add a secondary `restore_last_session` route.
4. When that route is selected, retain the identifier of the session visibly active immediately before leaving a profile and, after returning to a profile, open that profile’s last valid remembered session.
5. Fall back safely to a fresh draft when no remembered session exists, the remembered session is no longer valid, or ownership cannot yet be established.

## Non-Goals

- No change to profile backend selection, WebSocket routing, Projects isolation, or connection pooling.
- No restoration of arbitrary pages, overlays, terminal state, pane layout, or background tiles.
- No cross-profile or cross-connection session restoration.
- No change to new-session-in-profile, profile creation, wake-word, notification, or cold-start behavior.
- No new server RPC, database schema, or remote-backend configuration.

## User Stories

1. As a Desktop user, I can choose **Start fresh** as the profile-switch behavior, so switching profiles behaves exactly as native Hermes does today.
2. As a Desktop user, I can choose **Restore last session**, so returning to a profile opens the session I was last viewing there.
3. As a Desktop user, I can switch from Profile A to Profile B and back to Profile A without Profile B’s session ever appearing under Profile A.
4. As a Desktop user, I get a fresh draft when I return to a profile with no remembered session.
5. As a Desktop user, I get a fresh draft rather than an error when the remembered session was deleted, archived, unavailable, or cannot be ownership-validated.
6. As a Desktop user with multiple remote connections exposing the same profile names, remembered-session restoration remains scoped to the connection as well as the profile.
7. As a Desktop user, a background or non-focused tile does not override the session I was actively viewing when I explicitly switch profiles.
8. As a Desktop user, creating a new session in another profile still starts a new session; it does not unexpectedly restore an old one.
9. As a Desktop user, opening the app or following an explicit deep link keeps the existing native startup/deep-link behavior.
10. As a Desktop user, changing the setting affects future explicit profile switches without restarting or reconfiguring a remote backend.

## Behavioral Contract

### Setting values

- `fresh_draft` — default. Explicit profile switching invokes the existing native fresh-draft path.
- `restore_last_session` — optional. Explicit profile switching records the current visible session anchor before leaving a profile. Once the target profile is active and its session list can establish ownership, the app opens that profile’s remembered session. If no valid anchor exists, it invokes the same fresh-draft fallback.

### Anchor rules

- The anchor is a stored/lineage session identifier, never a raw runtime identifier.
- The anchor is keyed by the existing connection-plus-profile persistence scope.
- At selection time, capture the route-derived primary visible session identifier, not a background tile or a potentially stale generic selection atom.
- Only a route-derived session proven to belong to the outgoing active profile and current connection scope may be saved.
- The active visible session wins; background activity and non-chat routes cannot replace it.
- The feature restores a session only; it does not restore an arbitrary remembered route.
- If the remembered session already has an open session tile, restore must focus that existing tile through the native session-opening seam. It must not route the session into the main workspace, replace another tab, move a tile, or change tab order.

### Activation rules

- Only an explicit `selectProfile()` action can activate restore-last-session behavior.
- A restore intent records a target profile, initiating connection scope, and monotonic sequence. Newer explicit switches replace older pending intents; only the latest matching connection-plus-profile intent may consume.
- Restore mode immediately clears the outgoing chat into the existing neutral/pending switch surface without creating a durable new session. The prior profile transcript must not remain selected while target validation is pending.
- The restore waits for target-profile activation and an explicit target-session-list terminal state. It does not publish a second gateway route, synthesize a socket, or race profile refresh.
- Selecting the already-active profile remains a no-op.

## Acceptance Scenarios

1. Given `fresh_draft`, switching A → B creates a fresh B draft and switching B → A creates a fresh A draft.
2. Given `restore_last_session`, while viewing session A1, switching A → B records A1; returning to A opens A1.
3. Given A1 and B1 have the same display title or matching profile names across two connections, returning to A restores only A1 from the current connection/profile scope.
4. Given `restore_last_session` and no prior session in B, switching A → B opens a fresh B draft.
5. Given the remembered B session was removed or fails ownership validation, switching A → B opens a fresh B draft and clears the stale anchor.
6. Given target sessions have not loaded yet, the app waits without clearing the anchor; when they load, it restores only if ownership validates.
7. Given a project/new-session action explicitly targets B, it remains a new-session flow regardless of the switch behavior setting.
8. Given a deep link targets a session, it remains authoritative and is never overwritten by profile-switch restoration.
9. Given rapid A → B → C switching, a delayed B response cannot restore B after C is selected.
10. Given the same profile name exists on two remote connections, a pending intent from the first connection cannot restore under the second.
11. Given a target session fetch finishes empty, fails, or lacks the remembered session, the pending intent resolves deterministically to the existing fresh-draft fallback.
12. Given the setting changes while a restore intent is pending, the latest selected mode governs the final route without displaying the outgoing transcript.
13. Given five open A-profile session tabs with tab 3 focused, switching A → B → A focuses the original tab 3; all five tab identities and their order remain unchanged.

## Planned Seams

1. **Profile-selection seam:** `selectProfile()` determines whether the native fresh-draft route or a one-shot restore intent is requested.
2. **Desktop navigation seam:** the existing Desktop integration owner consumes the one-shot intent only after target profile activation and session ownership data are ready.
3. **Session-memory seam:** existing connection-plus-profile scoped remembered-session storage remains the sole persistence mechanism.
4. **Settings seam:** the Desktop Settings UI reads/writes one client-local preference and exposes two named values.

## Risks and Guardrails

- Do not revive the previous parallel foreground-navigation controller.
- Do not put this presentation preference in backend profile configuration: different Desktop clients may reasonably choose different behavior while connected to the same backend.
- Do not restore remembered routes; this feature has a smaller contract: one last-viewed session anchor.
- Preserve the existing cold-start restore behavior untouched.
- Keep any future public PR restricted to this behavior, its settings UI, localization, and focused regression tests.
