import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  $currentBranch,
  $currentCwd,
  $newChatWorkspaceTarget,
  setCurrentBranch,
  setCurrentCwd,
  setNewChatWorkspaceTarget
} from '@/store/session'
import { $projectScope, $projectTree, ALL_PROJECTS } from '@/store/projects'

import { startWorkspaceSession } from './workspace-session-target'

function deferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>(done => {
    resolve = done
  })

  return { promise, resolve }
}

describe('startWorkspaceSession', () => {
  afterEach(() => {
    setCurrentBranch('')
    setCurrentCwd('')
    setNewChatWorkspaceTarget(undefined)
    $projectScope.set(ALL_PROJECTS)
    $projectTree.set([])
    vi.restoreAllMocks()
  })

  it('keeps an explicit Home target detached from the previous project', () => {
    $projectScope.set('p_previous')
    $projectTree.set([
      {
        id: 'p_previous',
        label: 'Previous project',
        path: '/previous-workspace',
        previewSessions: [],
        repos: [],
        sessionCount: 0
      }
    ])
    setCurrentCwd('/previous-workspace')
    setNewChatWorkspaceTarget('/previous-workspace')

    const requestGateway = vi.fn()
    const followActiveSessionCwd = vi.fn()
    const onExplicitWorkspace = vi.fn()
    const startFreshSessionDraft = vi.fn((options?: { workspaceTarget: null | string }) => {
      setNewChatWorkspaceTarget(options?.workspaceTarget)
      setCurrentCwd(options?.workspaceTarget ?? '')
    })

    startWorkspaceSession({
      activeSessionIdRef: { current: null },
      followActiveSessionCwd,
      onExplicitWorkspace,
      path: null,
      requestGateway,
      startFreshSessionDraft
    })

    expect(startFreshSessionDraft).toHaveBeenCalledWith({ workspaceTarget: null })
    expect(requestGateway).not.toHaveBeenCalled()
    expect(followActiveSessionCwd).not.toHaveBeenCalled()
    expect(onExplicitWorkspace).not.toHaveBeenCalled()
    expect($newChatWorkspaceTarget.get()).toBeNull()
    expect($currentCwd.get()).toBe('')
  })

  it('keeps a newer sidebar target when an older project lookup resolves', async () => {
    const first = deferred<{ branch?: string; cwd?: string }>()
    const second = deferred<{ branch?: string; cwd?: string }>()

    const requestGateway = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const activeSessionIdRef = { current: null }

    const startFreshSessionDraft = vi.fn((options?: { workspaceTarget: null | string }) => {
      setNewChatWorkspaceTarget(options?.workspaceTarget)
      setCurrentCwd(options?.workspaceTarget || '')
    })

    const followActiveSessionCwd = vi.fn()

    startWorkspaceSession({
      activeSessionIdRef,
      followActiveSessionCwd,
      path: '/workspace-a',
      requestGateway,
      startFreshSessionDraft
    })
    startWorkspaceSession({
      activeSessionIdRef,
      followActiveSessionCwd,
      path: '/workspace-b',
      requestGateway,
      startFreshSessionDraft
    })

    first.resolve({ branch: 'stale', cwd: '/normalized-a' })
    await first.promise
    await Promise.resolve()

    expect($newChatWorkspaceTarget.get()).toBe('/workspace-b')
    expect($currentCwd.get()).toBe('/workspace-b')
    expect($currentBranch.get()).not.toBe('stale')

    second.resolve({ branch: 'main', cwd: '/normalized-b' })
    await second.promise
    await Promise.resolve()

    expect($newChatWorkspaceTarget.get()).toBe('/normalized-b')
    expect($currentCwd.get()).toBe('/normalized-b')
    expect($currentBranch.get()).toBe('main')
  })
})
