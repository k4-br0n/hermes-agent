import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'

import { closeActiveTab } from '@/app/chat/close-tab'
import { commandFocusedPreview } from '@/app/chat/right-rail/preview-nav'
import { openSession } from '@/app/open-session'
import { resolveDeepLinkAction } from '@/lib/deeplink-routes'
import { pathFromHermesDeepLink, resolveHermesOpenPath } from '@/lib/hermes-open-target'
import { storedSessionIdForNotification } from '@/lib/session-ids'
import { resolveUniqueSessionOwner } from '@/sdk/index'
import { $pendingConnectionId } from '@/store/connections'
import { requestMcpInstallFromDeepLink } from '@/store/mcp-deeplink-install'
import { startMcpHealthChecker, stopMcpHealthChecker } from '@/store/mcp-health'
import {
  clearPluginNotifyHandlers,
  invokePluginNotifyAction,
  invokePluginNotifyActivate,
  respondToApprovalAction
} from '@/store/native-notifications'
import { openPluginInstallRequest } from '@/store/plugin-install-request'
import {
  $profileSwitchBehavior,
  $profileSwitchRestoreIntent,
  clearProfileSwitchRestoreIntent
} from '@/store/profile-switch-behavior'
import { openFolderAsProject } from '@/store/projects'
import {
  $sessions,
  getRememberedRoute,
  getRememberedSessionId,
  sessionBelongsToProfile,
  setRememberedRoute,
  setRememberedSessionId
} from '@/store/session'
import { $focusedStoredSessionId, markSelectionRestore } from '@/store/session-states'
import { onSessionsChanged } from '@/store/session-sync'
import { openUpdatesWindow, startUpdatePoller, stopUpdatePoller } from '@/store/updates'
import { isHudWindow, isSecondaryWindow } from '@/store/windows'
import type { SessionInfo } from '@/types/hermes'

import { requestComposerFocus, requestComposerInsert } from '../../chat/composer/focus'
import { focusRetainedSessionPane } from '../../chat/pane-mirror'
import { appViewForPath, isOverlayView, NEW_CHAT_ROUTE, routeSessionId, sessionRoute } from '../../routes'

type RememberedSession = Pick<SessionInfo, '_lineage_root_id' | 'connection_id' | 'id' | 'profile'>

interface DesktopIntegrationsParams {
  activeConnectionId: null | string
  activeProfile: string
  chatOpen: boolean
  hasPreview: boolean
  locationPathname: string
  navigate: (to: string, options?: { replace?: boolean }) => void
  profileReady: boolean
  refreshSessions: () => Promise<unknown> | unknown
  resumeExhaustedSessionId: null | string
  routedSessionId: null | string
  runtimeIdByStoredSessionId: { readonly current: Map<string, string> }
  sessions: readonly RememberedSession[]
}

/**
 * All the Electron-main / OS / cross-window integrations the shell listens for:
 * update polling, the ⌘W close shortcut, deep links, native-notification
 * navigation, preview-shortcut enablement, remembered-session restore, and
 * cross-window session-list sync. Kept out of the wiring controller so the
 * "talks to the desktop shell" surface reads as one unit.
 */
export function useDesktopIntegrations({
  activeConnectionId,
  activeProfile,
  locationPathname,
  navigate,
  profileReady,
  refreshSessions,
  resumeExhaustedSessionId,
  routedSessionId,
  runtimeIdByStoredSessionId,
  sessions
}: DesktopIntegrationsParams): void {
  // Update polling — populates $desktopVersion/$updateStatus, which feed the
  // statusbar version pill and the update toasts. Also honors the main
  // process's "open updates" menu request.
  useEffect(() => {
    startUpdatePoller()
    // Background MCP health: HTTP/SSE servers only (never spawns stdio),
    // notifies on transitions into needs-auth/error with a Sign in action.
    startMcpHealthChecker()
    const unsubscribe = window.hermesDesktop?.onOpenUpdatesRequested?.(() => openUpdatesWindow())

    return () => {
      unsubscribe?.()
      stopUpdatePoller()
      stopMcpHealthChecker()
    }
  }, [])

  // The renderer OWNS ⌘W: on macOS the native menu accelerator would else
  // close the window, so claim it unconditionally — the menu then routes ⌘W
  // to us (close-preview-requested IPC) and we decide tab-vs-window.
  useEffect(() => {
    window.hermesDesktop?.setPreviewShortcutActive?.(true)
  }, [])

  const restoredRef = useRef(false)
  const profileSwitchBehavior = useStore($profileSwitchBehavior)
  const profileSwitchRestoreIntent = useStore($profileSwitchRestoreIntent)
  const pendingConnectionId = useStore($pendingConnectionId)
  const focusedStoredSessionId = useStore($focusedStoredSessionId)
  const navigationToken = `${locationPathname}\u0000${focusedStoredSessionId ?? ''}`
  const navigationRef = useRef(navigationToken)
  const restoringNavigationRef = useRef<null | { sequence: number; token: string }>(null)

  // eslint-disable-next-line no-restricted-syntax -- exact navigation capture cancels only the in-flight restore
  useEffect(() => {
    const restoring = restoringNavigationRef.current

    if (restoring && restoring.token !== navigationToken) {
      clearProfileSwitchRestoreIntent(restoring.sequence)
    }

    navigationRef.current = navigationToken
  }, [navigationToken])

  // Explicit profile-switch restore is deliberately separate from the one-shot
  // cold-start `restoredRef` behavior below. It restores a session through the
  // native openSession door, so an already-open tile is focused in place rather
  // than being routed into main, replaced, or reordered.
  // eslint-disable-next-line no-restricted-syntax -- async restore owns a cancellation/capture ref, not mirrored app state
  useEffect(() => {
    const intent = profileSwitchRestoreIntent

    if (
      !intent ||
      $profileSwitchRestoreIntent.get()?.sequence !== intent.sequence ||
      isHudWindow() ||
      isSecondaryWindow()
    ) {
      return
    }

    if (profileSwitchBehavior !== 'restore_last_session') {
      clearProfileSwitchRestoreIntent(intent.sequence)

      return
    }

    if (pendingConnectionId) {
      clearProfileSwitchRestoreIntent(intent.sequence)

      return
    }

    if (intent.connectionId === undefined) {
      return
    }

    if (intent.connectionId !== activeConnectionId) {
      clearProfileSwitchRestoreIntent(intent.sequence)

      return
    }

    if (!profileReady || intent.profile !== activeProfile) {
      return
    }

    let cancelled = false
    restoringNavigationRef.current = { sequence: intent.sequence, token: navigationRef.current }

    const recoverDraft = () => {
      clearProfileSwitchRestoreIntent(intent.sequence)
      setRememberedRoute(null, activeProfile)
      setRememberedSessionId(null, activeProfile)
      navigate(NEW_CHAT_ROUTE, { replace: true })
    }

    // Use the existing scoped refresh as the completion barrier. It reports
    // whether this request actually committed; if another refresh supersedes
    // it, retry as the newest request instead of validating stale rows.
    void (async () => {
      let committed = false

      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        const result = await Promise.resolve(refreshSessions())

        if (result !== false) {
          committed = true

          break
        }
      }

      if (cancelled) {
        return
      }

      const latest = $profileSwitchRestoreIntent.get()

      if (
        latest?.sequence !== intent.sequence ||
        latest.connectionId !== activeConnectionId ||
        latest.profile !== activeProfile
      ) {
        return
      }

      if (!committed) {
        recoverDraft()

        return
      }

      const refreshed = $sessions.get()
      const mainRoute = getRememberedRoute(activeProfile)
      const mainSessionId = routeSessionId(mainRoute ?? '')
      const last = getRememberedSessionId(activeProfile)

      const ownerMatchesTarget = (sessionId: string) => {
        const owner = resolveUniqueSessionOwner(refreshed, sessionId)

        return owner?.connectionId === activeConnectionId && owner.profile === activeProfile
      }

      const mainOwned = Boolean(mainSessionId && ownerMatchesTarget(mainSessionId))
      const lastOwned = Boolean(last && ownerMatchesTarget(last))

      if (mainSessionId && !mainOwned) {
        setRememberedRoute(null, activeProfile)
      }

      if (last && !lastOwned) {
        setRememberedSessionId(null, activeProfile)
      }

      if (!mainOwned && !lastOwned) {
        recoverDraft()

        return
      }

      clearProfileSwitchRestoreIntent(intent.sequence)

      if (mainRoute && mainSessionId && mainOwned) {
        if (lastOwned && last !== mainSessionId) {
          markSelectionRestore()
        }

        navigate(mainRoute, { replace: true })
      }

      if (last && lastOwned && last !== mainSessionId) {
        if (!focusRetainedSessionPane(last)) {
          openSession(last, navigate, 'in-place')
        }
      }
    })().catch(() => {
      if (!cancelled) {
        recoverDraft()
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    activeConnectionId,
    activeProfile,
    navigate,
    pendingConnectionId,
    profileReady,
    profileSwitchBehavior,
    profileSwitchRestoreIntent,
    refreshSessions
  ])

  // Wait until boot has adopted the primary profile, then restore that profile's
  // navigation exactly once. The same effect owns subsequent writes so the
  // initial `/` cannot overwrite remembered history before it is read.
  // This ref is a one-time lifecycle latch, not a mirror of reactive atom state.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!profileReady || isHudWindow()) {
      return
    }

    if (!restoredRef.current) {
      // Only cold-start navigation at the default route is replaceable; a deep
      // link or hidden-then-shown window keeps its explicit destination.
      if (locationPathname === NEW_CHAT_ROUTE) {
        const route = getRememberedRoute(activeProfile)
        const routeSession = route ? routeSessionId(route) : null
        const last = getRememberedSessionId(activeProfile)

        const restorableNonSessionRoute =
          !!route && route !== NEW_CHAT_ROUTE && !routeSession && !isOverlayView(appViewForPath(route))

        // Boot adoption can publish renderer.ready before its async session
        // refresh completes. Keep the restore latch open until ownership can be
        // decided; treating an unloaded list as authoritative would erase valid
        // remembered navigation permanently.
        if (sessions.length === 0 && !restorableNonSessionRoute && (routeSession || last)) {
          return
        }

        restoredRef.current = true

        if (
          route &&
          route !== NEW_CHAT_ROUTE &&
          !isOverlayView(appViewForPath(route)) &&
          (!routeSession || sessionBelongsToProfile(sessions, routeSession, activeProfile))
        ) {
          navigate(route, { replace: true })

          return
        }

        // A remembered route carried a session id we can no longer validate —
        // clear the stale entry so the next cold start won't re-try it.
        if (routeSession) {
          setRememberedRoute(null, activeProfile)
        }

        if (last && sessionBelongsToProfile(sessions, last, activeProfile)) {
          navigate(sessionRoute(last), { replace: true })

          return
        }

        if (last) {
          setRememberedSessionId(null, activeProfile)
        }
      } else {
        restoredRef.current = true
      }
    }

    // Remember the open chat (session id for notifications/resume) AND the last
    // non-overlay route (a page like /skills, or a session route) per profile.
    // Session-shaped routes require an explicit matching owner; unresolved and
    // wrong-profile rows must not replace known-safe navigation.
    if (routedSessionId && sessionBelongsToProfile(sessions, routedSessionId, activeProfile)) {
      setRememberedSessionId(routedSessionId, activeProfile)
      setRememberedRoute(locationPathname, activeProfile)
    } else if (
      !routedSessionId &&
      !isOverlayView(appViewForPath(locationPathname)) &&
      !(
        profileSwitchBehavior === 'restore_last_session' &&
        profileSwitchRestoreIntent &&
        locationPathname === NEW_CHAT_ROUTE
      )
    ) {
      setRememberedRoute(locationPathname, activeProfile)
    }
  }, [
    activeProfile,
    locationPathname,
    navigate,
    profileReady,
    profileSwitchBehavior,
    profileSwitchRestoreIntent,
    routedSessionId,
    sessions
  ])

  useEffect(() => {
    if (!profileReady || !resumeExhaustedSessionId) {
      return
    }

    if (getRememberedSessionId(activeProfile) === resumeExhaustedSessionId) {
      setRememberedSessionId(null, activeProfile)
    }

    if (routeSessionId(getRememberedRoute(activeProfile) ?? '') === resumeExhaustedSessionId) {
      setRememberedRoute(null, activeProfile)
    }
  }, [activeProfile, profileReady, resumeExhaustedSessionId])

  // Native-notification click -> jump to the session WHERE IT ALREADY IS (open
  // tile / main), else beside what's loaded rather than over it — the click
  // came from outside the app and shouldn't cost the user the chat they left
  // on screen. Runtime id is translated to the stored id the chat route is
  // keyed by; action buttons resolve in place.
  useEffect(() => {
    const unsubscribe = window.hermesDesktop?.onFocusSession?.(sessionId => {
      if (sessionId) {
        openSession(storedSessionIdForNotification(sessionId, runtimeIdByStoredSessionId.current), navigate, 'stack')
      }
    })

    return () => unsubscribe?.()
  }, [navigate, runtimeIdByStoredSessionId])

  useEffect(() => {
    const unsubscribe = window.hermesDesktop?.onNotificationAction?.(({ actionId, sessionId }) => {
      void respondToApprovalAction(sessionId ?? null, actionId)
    })

    return () => unsubscribe?.()
  }, [])

  // Plugin OS notification body/action → optional callback + navigate. Activation
  // is user-driven (click), so this is offer-not-hijack. Paths share the
  // hermes://index-network/intent/1 vocabulary with deep links.
  useEffect(() => {
    const unsubscribe = window.hermesDesktop?.onNotificationActivate?.(payload => {
      if (!payload) {
        return
      }

      if (payload.actionId) {
        invokePluginNotifyAction(payload.notifyId, payload.actionId)
      } else {
        invokePluginNotifyActivate(payload.notifyId)
      }

      if (payload.activate) {
        // Defense-in-depth: re-resolve at the IPC boundary rather than trusting
        // the pre-IPC validation — any future hermesDesktop.notify caller gets
        // funneled through the same resolver.
        const path = resolveHermesOpenPath(payload.activate)

        if (path) {
          navigate(path)
        }
      }

      clearPluginNotifyHandlers(payload.notifyId)
    })

    return () => unsubscribe?.()
  }, [navigate])

  // hermes:// deep links:
  //  - mcp/install?… → pending MCP install (explicit confirm, never auto-install)
  //  - plugin/install?… (and legacy plugin-agent/plugin-desktop) → plugin install
  //    modal awaiting explicit confirmation. Never auto-installs.
  //  - blueprint/<name>?… → reviewable /blueprint command in the composer
  //  - <plugin>/<path>?… → in-app navigate (e.g. index-network/intent/1)
  //  - open/<path>?… → in-app navigate (generic)
  useEffect(() => {
    const unsubscribe = window.hermesDesktop?.onDeepLink?.(payload => {
      if (!payload?.kind) {
        return
      }

      if (payload.kind === 'mcp' && payload.name === 'install') {
        requestMcpInstallFromDeepLink(payload.params || {})

        return
      }

      const action = resolveDeepLinkAction(payload)

      if (action.type === 'composer-blueprint') {
        const slots = Object.entries(action.params || {})
          .map(([k, v]) => {
            const sval = /\s/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v

            return `${k}=${sval}`
          })
          .join(' ')

        const command = `/blueprint ${action.name}${slots ? ' ' + slots : ''}`
        requestComposerInsert(command, { mode: 'block', target: 'main' })
        requestComposerFocus('main')

        return
      }

      if (action.type === 'plugin-install') {
        openPluginInstallRequest({
          repo: action.repo,
          enable: action.enable,
          force: action.force,
          legacyHint: action.legacyHint
        })

        return
      }

      // Not a core action — treat as a plugin-scoped or open/ navigation deep
      // link (hermes://index-network/intent/1, hermes://open/…). The resolver
      // rejects reserved kinds and unsafe paths.
      const path = pathFromHermesDeepLink(payload.kind, payload.name || '', payload.params || {})

      if (path) {
        navigate(path)
      }
    })

    void window.hermesDesktop?.signalDeepLinkReady?.()

    return () => unsubscribe?.()
  }, [navigate])

  // ⌘W via the macOS menu accelerator → close the focused tab; if nothing is
  // closeable, fall back to closing the window (so ⌘W still works as the
  // OS-standard window close, esp. secondary windows). The Win/Linux keyboard
  // path is the `view.closeTab` keybind (use-keybinds), sharing closeActiveTab.
  useEffect(() => {
    const unsubscribe = window.hermesDesktop?.onClosePreviewRequested?.(
      () => void closeActiveTab(id => navigate(sessionRoute(id)))
    )

    return () => unsubscribe?.()
  }, [navigate])

  // Native browser gestures (⌘R, a mouse's back/forward buttons, a trackpad
  // swipe) that landed on the app's own chrome rather than inside a page — main
  // answers those against the focused guest and never asks. Only ⌘R has an
  // app-level meaning to fall back to; an unfocused swipe is a no-op.
  useEffect(() => {
    const unsubscribe = window.hermesDesktop?.onPreviewNav?.(command => {
      if (!commandFocusedPreview(command) && command === 'reload') {
        window.location.reload()
      }
    })

    return () => unsubscribe?.()
  }, [])

  // File > Open Folder… — same open-folder-as-project upsert as the ⌘O keybind.
  useEffect(() => {
    const unsubscribe = window.hermesDesktop?.onOpenFolderRequested?.(() => void openFolderAsProject())

    return () => unsubscribe?.()
  }, [])

  // Another window mutated the shared session list -> re-pull the sidebar.
  useEffect(() => {
    if (isSecondaryWindow()) {
      return
    }

    return onSessionsChanged(() => void refreshSessions())
  }, [refreshSessions])
}
