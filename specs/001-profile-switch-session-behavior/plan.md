# Profile Switch Session Behavior — Implementation Plan

> **For Hermes:** Use the native Desktop profile, session-memory, and Desktop-integration seams. Do not revive the prior standalone foreground-restore hook.

**Goal:** Add a small Desktop preference that lets users select either native fresh-draft profile switching or restore-last-session switching.

**Architecture:** Keep the existing `selectProfile()` action as the only profile-selection entry point. The setting changes only the one-shot navigation intent emitted by that action. Existing connection-plus-profile session memory remains authoritative; the existing Desktop integration owner validates and opens the remembered session only after the target profile is active and its session list is ready.

**Storage decision:** This is a client-local Desktop preference, not backend/profile config. It affects renderer navigation on one machine and must not alter other clients connected to the same backend. Default value is `fresh_draft`.

**Tech stack:** Electron/React, Nanostores, existing Desktop local storage abstraction, Vitest.

---

## Constitution / Constraints

1. **Default is unchanged.** `fresh_draft` must preserve current upstream `selectProfile()` behavior exactly.
2. **One navigation owner.** The existing Desktop integrations layer owns restore timing and navigation. No parallel hook, socket path, profile publisher, or route controller.
3. **One persistence owner.** Existing remembered-session storage keyed by connection and profile owns the anchor. Do not add a second localStorage key for last session.
4. **Session-only restoration.** Do not restore pages, overlays, pane layout, terminal state, or arbitrary routes.
5. **Targeted public contribution.** Future PR scope is setting + profile-switch intent + native integration + tests + localization only. Exclude current private multi-profile deployment layers.

## Existing Native Seams

| Concern | Native owner to reuse | Planned use |
|---|---|---|
| Explicit profile selection | `selectProfile()` | Decide native fresh draft vs emit one restore intent. |
| Active profile transition | `ensureGatewayProfile()` / `$activeGatewayProfile` | Do not alter; wait for it. |
| Remembered session persistence | `getRememberedSessionId()` / `setRememberedSessionId()` | Reuse current connection-plus-profile scoped session identity. |
| Session ownership check | `sessionBelongsToProfile()` | Validate before open and clear invalid memory. |
| Session route handling | `sessionRoute()` + existing route-resume machinery | Navigate only to a validated stored session. |
| Ready/list lifecycle | `useDesktopIntegrations` | Consume a one-shot restore intent after profile activation and loaded session data. |
| Local Desktop preferences | `persistString()` / `storedString()` | Persist the two-value client-local preference. |
| Settings presentation | existing Settings `ListRow` + `Select` patterns | Add one two-option row without a new settings page. |

## Proposed Design

### 1. Add a client-local switch preference

Create a small Desktop store with a closed two-value type:

- `fresh_draft` (default)
- `restore_last_session`

Normalize unknown persisted values to `fresh_draft`. Expose read/write helpers and an observable state suitable for the Settings row and the profile-selection action.

### 2. Preserve an outgoing session anchor only for restore mode

When an explicit profile switch starts in `restore_last_session` mode:

- use a capture bridge registered by the existing Desktop integration owner to read the current route-derived visible stored session before the profile swap begins;
- confirm it belongs to the outgoing active profile;
- write it through the existing `setRememberedSessionId()` API;
- never persist an unvalidated session, a background session, or a raw runtime ID.

When mode is `fresh_draft`, do not change this path; it stays the exact upstream fresh-draft route.

### 3. Emit a one-shot restore intent, then await native readiness

For restore mode, `selectProfile()` emits an intent containing the target profile, initiating connection scope, and monotonic sequence. A later explicit switch replaces the older intent. It still calls `ensureGatewayProfile(target)` normally.

Restore mode also triggers the existing neutral switch-state path immediately, so the outgoing profile transcript is not left visible while the target profile is loading. This does not create a durable fresh session.

The existing Desktop integrations owner consumes that intent only when:

- the active connection-plus-profile scope equals the intent scope;
- the intent is still the latest sequence;
- the target session-list request has reached an explicit completed or failed terminal state;
- the target session data can validate ownership.

It then uses `getRememberedSessionId(target)` and `sessionBelongsToProfile()`:

- valid → call the native `openSession(id, navigate, 'in-place')` seam. That seam focuses an already-open session tile without navigation or tile mutation; only a closed session follows the normal route-resume path;
- missing/invalid → clear stale memory if needed and trigger the existing fresh-draft fallback;
- pending list data → retain the intent and wait; do not clear memory prematurely;
- completed-empty, failed, or invalid ownership → clear only stale remembered session memory and invoke the existing fresh-draft fallback.

The intent is consumed once. It must not affect cold start, deep links, session notification actions, wake-word/new-session flows, profile creation, or repeated selection of the already-active profile. The existing cold-start `restoredRef` logic remains untouched; explicit-switch restoration is a separate intent-gated effect in the same owner and restores sessions only.

### 4. Add one Settings row

Place a compact `Profile switching` row in the existing Desktop settings surface that already owns client behavior preferences. It presents:

- **Start fresh** — current Hermes behavior.
- **Restore last session** — return to the last valid session for the selected profile.

The description must say this setting is local to the Desktop client. Add translation keys consistently with the repository’s current locale contract.

## Test Strategy

### Primary seam: explicit profile selection → active target → route outcome

Test through the existing profile store + Desktop integration seam, not a standalone restoration controller.

1. Native default: A → B invokes the existing fresh-draft request and does not navigate to a remembered B session.
2. Restore mode: viewing A1, switch A → B → A; A1 is opened after A is active and its session list validates ownership.
3. Missing B memory: restore mode falls back to a fresh B draft.
4. Stale/wrong-owner memory: restore mode does not navigate cross-profile and clears stale state.
5. Delayed target session list: no early fresh fallback or anchor deletion; valid session opens when ownership data arrives.
6. Same profile selection: no navigation action.
7. Explicit new-session-in-profile remains fresh regardless of setting.
8. Same profile labels across connections: memory remains connection-plus-profile scoped.
9. Deep link and cold-start restore behavior remain unchanged.
10. Rapid A → B → C: only C’s latest matching intent can resolve.
11. Connection swap while B is pending: B’s intent cannot restore on the new connection.
13. During restore-mode loading, no outgoing-profile transcript/session remains selected.
14. Completed-empty and failed session-list results fall back safely and deterministically.
15. Five open tabs with tab 3 focused: A → B → A focuses the original tab 3 and preserves all tile identities and order.

### Settings seam

1. Default is `fresh_draft` when no saved preference exists.
2. Both settings values persist and unknown values normalize to native default.
3. The settings row updates the next explicit profile switch without a backend/config write.

### Quality gates

- Relevant `apps/desktop/src/store/profile.ts`, `apps/desktop/src/store/session.ts`, `apps/desktop/src/app/contrib/hooks/use-desktop-integrations.ts`, settings, and route-resume Vitest suites.
- Desktop typecheck and lint.
- A macOS packaged-app smoke proof only after the feature implementation passes Linux CI-equivalent checks.
- Before a public PR: prove the new restore regression test fails when the restore-mode branch is removed, then restore the implementation and rerun it.

## Rollout and Rollback

- Default ships as `fresh_draft`, so existing users see no behavioral change.
- A user enables `restore_last_session` explicitly.
- Rollback is selecting `Start fresh`; no server data migration or config repair is necessary.
- Do not deploy this feature to the target Desktop client until the targeted branch has passed review and public-PR readiness review.

## PR Readiness Gate

Before proposing a public PR:

1. Rebase onto current upstream main.
2. Re-run duplicate PR/issue search for profile switching and remembered session restoration.
3. Audit branch name, commits, diffs, test fixtures, screenshots, and PR body for private identifiers.
4. Show the maintainer the sanitized PR title/body and ask for explicit publication approval.
