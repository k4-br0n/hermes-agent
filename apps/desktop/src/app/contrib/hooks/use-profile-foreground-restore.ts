import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { $profileForegroundRestoreRequest, normalizeProfileKey } from '@/store/profile'
import { getRememberedRoute, getRememberedSessionId, sessionBelongsToProfile } from '@/store/session'
import { focusOpenSession } from '@/store/session-states'
import type { SessionInfo } from '@/types/hermes'

import { appViewForPath, isOverlayView, NEW_CHAT_ROUTE, routeSessionId, sessionRoute } from '../../routes'

interface ProfileForegroundRestoreParams {
  activeProfile: string
  navigate: (to: string, options?: { replace?: boolean }) => void
  sessions: readonly Pick<SessionInfo, '_lineage_root_id' | 'id' | 'profile'>[]
  startFreshSessionDraft: (options: { preserveRoute: boolean; workspaceTarget: null }) => void
}

/**
 * Re-home the foreground after upstream has atomically activated a different
 * profile. A remembered session that is already a tile stays a tile: only a
 * missing target falls back to the main-route resume path.
 */
export function useProfileForegroundRestore({
  activeProfile,
  navigate,
  sessions,
  startFreshSessionDraft
}: ProfileForegroundRestoreParams): void {
  const profileForegroundRestoreRequest = useStore($profileForegroundRestoreRequest)
  const [handledSequence, setHandledSequence] = useState(0)

  useEffect(() => {
    if (
      !profileForegroundRestoreRequest ||
      profileForegroundRestoreRequest.sequence === handledSequence ||
      normalizeProfileKey(activeProfile) !== profileForegroundRestoreRequest.profile
    ) {
      return
    }

    setHandledSequence(profileForegroundRestoreRequest.sequence)
    const rememberedRoute = getRememberedRoute(profileForegroundRestoreRequest.profile)
    const routeSessionIdValue = rememberedRoute ? routeSessionId(rememberedRoute) : null
    const rememberedSessionId = getRememberedSessionId(profileForegroundRestoreRequest.profile) ?? routeSessionIdValue

    startFreshSessionDraft({ preserveRoute: true, workspaceTarget: null })

    if (
      rememberedSessionId &&
      sessionBelongsToProfile(sessions, rememberedSessionId, profileForegroundRestoreRequest.profile)
    ) {
      if (focusOpenSession(rememberedSessionId) === 'tile') {
        return
      }

      navigate(sessionRoute(rememberedSessionId), { replace: true })

      return
    }

    if (
      rememberedRoute &&
      rememberedRoute !== NEW_CHAT_ROUTE &&
      !routeSessionIdValue &&
      !isOverlayView(appViewForPath(rememberedRoute))
    ) {
      navigate(rememberedRoute, { replace: true })
    }
  }, [activeProfile, navigate, profileForegroundRestoreRequest, sessions, startFreshSessionDraft])
}
