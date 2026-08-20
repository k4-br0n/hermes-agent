import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestProfileForegroundRestore } from '@/store/profile'
import { setRememberedRoute, setRememberedSessionId } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'
import type { SessionInfo } from '@/types/hermes'

import { useProfileForegroundRestore } from './use-profile-foreground-restore'

const session = (id: string, profile: string): SessionInfo =>
  ({
    ended_at: null,
    id,
    input_tokens: 0,
    is_active: false,
    last_active: 1,
    message_count: 1,
    model: null,
    output_tokens: 0,
    preview: null,
    profile,
    source: 'desktop',
    started_at: 1,
    title: id,
    tool_call_count: 0
  }) as SessionInfo

describe('useProfileForegroundRestore', () => {
  afterEach(() => {
    cleanup()
    $sessionTiles.set([])
    setRememberedRoute(null, 'target')
    setRememberedSessionId(null, 'target')
    vi.restoreAllMocks()
  })

  it('focuses an already-open remembered tile without routing it into main', () => {
    setRememberedSessionId('target-session', 'target')
    setRememberedRoute('/target-session', 'target')
    $sessionTiles.set([{ storedSessionId: 'target-session' }])
    const navigate = vi.fn()
    const startFreshSessionDraft = vi.fn()
    const sessions = [session('target-session', 'target')]

    const { rerender } = renderHook(
      ({ activeProfile }) => useProfileForegroundRestore({ activeProfile, navigate, sessions, startFreshSessionDraft }),
      { initialProps: { activeProfile: 'other' } }
    )

    requestProfileForegroundRestore('target')
    rerender({ activeProfile: 'target' })

    expect(startFreshSessionDraft).toHaveBeenCalledWith({ preserveRoute: true, workspaceTarget: null })
    expect(navigate).not.toHaveBeenCalled()
    expect($sessionTiles.get()).toEqual([{ storedSessionId: 'target-session' }])
  })
})
