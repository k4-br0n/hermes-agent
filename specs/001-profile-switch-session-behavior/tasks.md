# Profile Switch Session Behavior — Task Plan

> Local SpecKit-style `/tasks` artifact. Execute only after the maintainer approves the spec and plan.

## T001 — Confirm the public contribution baseline

**Objective:** Re-fetch upstream main and verify no merged/open PR already adds a configurable explicit profile-switch restore behavior.

**Files:**
- Read: upstream Desktop profile, session, settings, and integration modules
- Read: current issue/PR search results

**Steps:**
1. Search open and recent merged PRs for profile switching, session restore, and remembered-session behavior.
2. Inspect current upstream `selectProfile()` and the Desktop integrations owner.
3. Record any competing design in `research.md`.
4. Stop if an upstream implementation supersedes this feature.

**Verification:** Current baseline and duplication status recorded before code is written.

---

## T002 — Add the failing preference-store tests

**Objective:** Define the local preference contract before implementation.

**Files:**
- Create: Desktop profile-switch behavior store test
- Create: Desktop profile-switch behavior store

**Red tests:**
1. Missing stored value resolves to `fresh_draft`.
2. `restore_last_session` persists and reloads.
3. Unknown persisted value normalizes to `fresh_draft`.

**Green implementation:** Add the smallest typed local preference store using the existing storage utility.

**Verification:** Run only the new store test file.

**Commit:** `feat(desktop): add profile switch behavior preference`

---

## T003 — Add the failing native-route profile-selection test

**Objective:** Prove default behavior remains untouched.

**Files:**
- Modify: `apps/desktop/src/store/profile.ts`
- Test: `apps/desktop/src/store/profile-agent-activation.test.ts`

**Red test:** With the unset/default preference, switching profiles emits exactly the existing fresh-draft path and no restore intent.

**Green implementation:** Read the preference at the existing explicit profile-selection seam. Leave all native behavior unchanged for `fresh_draft`.

**Verification:** Run the profile-store test file; test must fail if the native branch is replaced by restore behavior.

**Commit:** `feat(desktop): preserve native profile switch route`

---

## T004 — Add the failing restore-mode anchor test

**Objective:** Capture only the visible outgoing session through existing session memory.

**Files:**
- Modify: `apps/desktop/src/store/profile.ts`
- Modify: `apps/desktop/src/store/session.ts` only if a small existing-owner helper is needed
- Test: `apps/desktop/src/store/profile-agent-activation.test.ts`
- Test: `apps/desktop/src/store/session.test.ts`

**Red tests:**
1. Restore mode stores the valid route-derived outgoing visible stored-session ID under the outgoing connection/profile scope.
2. Wrong-owner, missing, and runtime-only IDs are not stored.
3. New-session-in-profile does not create a restore intent.
4. A newer A → B → C selection cancels the older B intent.
5. A connection-scope change invalidates a pending intent.

**Green implementation:** Add a minimal one-shot target-profile restore intent. Reuse existing remembered-session persistence and ownership validation.

**Verification:** Run the affected profile/session tests.

**Commit:** `feat(desktop): remember session before profile switch`

---

## T005 — Add the failing target-profile restoration tests

**Objective:** Restore only a valid last session after native profile activation is ready.

**Files:**
- Modify: `apps/desktop/src/app/contrib/hooks/use-desktop-integrations.ts`
- Test: `apps/desktop/src/app/contrib/hooks/use-desktop-integrations.test.tsx`

**Red tests:**
1. Restore mode navigates to the remembered target session only after target profile/session readiness.
2. Empty target list keeps the intent pending when a remembered anchor exists.
3. Valid data later arriving restores the session.
4. Missing or invalid remembered session falls back to the existing fresh-draft path and clears stale memory.
5. The restore is single-use.
6. The outgoing profile transcript is neutralized while the target session list is pending.
7. A completed-empty or failed target fetch resolves to fresh draft; a pending fetch does not.
8. The explicit-switch effect never reruns the existing cold-start route restoration.
9. With five existing session tiles and tile 3 focused, A → B → A uses the native in-place `openSession` seam to focus tile 3 without navigating, replacing tab 1, moving a pane, or changing tab order.

**Green implementation:** Consume the intent inside the existing Desktop integrations owner. Use the existing session route and ownership helpers; do not add a second hook/controller.

**Verification:** Run the Desktop integrations test file and route-resume regression tests.

**Commit:** `feat(desktop): restore last session on profile return`

---

## T006 — Add the Desktop Settings control

**Objective:** Let a user select the two behavior routes.

**Files:**
- Modify: existing Desktop settings surface
- Modify: locale/type resources required by the current i18n contract
- Modify: settings test file or create a focused test

**Red tests:**
1. Settings displays Start fresh and Restore last session.
2. Changing the control updates the local preference only.
3. No backend config RPC is sent.

**Green implementation:** Add one compact select row using existing settings components and client-local preference store.

**Verification:** Run the focused settings test and relevant locale/type check.

**Commit:** `feat(desktop): configure profile switch behavior`

---

## T007 — Run focused integration proof

**Objective:** Prove both routes coexist without changing unrelated behavior.

**Files:**
- Test only

**Steps:**
1. Run profile store, session memory, Desktop integrations, route-resume, and Settings tests.
2. Run Desktop typecheck and lint.
3. Temporarily disable the restore-mode implementation and confirm the new restore test fails; restore implementation and rerun green.
4. Inspect changes for unintended connection, backend, Projects, or cold-start modifications.

**Verification:** All focused tests pass; sabotage run fails as expected; diff is limited to preference, selection intent, native navigation owner, settings UI, localization, and tests.

**Commit:** `test(desktop): cover profile switch session behavior`

---

## T008 — Public PR readiness review

**Objective:** Decide whether the implementation is suitable for a targeted upstream PR.

**Files:**
- Review only

**Steps:**
1. Rebase onto current upstream main.
2. Compare the diff against any newly merged profile-switch PRs.
3. Run code review focused on reuse, behavior ownership, cross-connection isolation, and race handling.
4. Prepare a sanitized PR title/body with problem, two modes, tests, default compatibility, and non-goals.
5. Present the sanitized public payload to the maintainer for approval.

**Verification:** No public push/PR occurs without a separate explicit approval.
