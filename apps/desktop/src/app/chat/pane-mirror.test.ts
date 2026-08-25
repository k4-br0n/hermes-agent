import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { group, split } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree, activateTreePane, revealTreePane } from '@/components/pane-shell/tree/store'
import { contributesToWorkspace } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib/registry'
import { $profileSwitchRestoreIntent, requestProfileSwitchRestore } from '@/store/profile-switch-behavior'

import { focusRetainedSessionPane, paneMirror } from './pane-mirror'

interface Tile {
  id: string
  owner?: string
}

const cleanupSources: Array<ReturnType<typeof atom<Tile[]>>> = []
let sequence = 0

function setup(
  options: {
    workspaceMode?: 'sessions' | 'bots' | ((tile: Tile) => 'sessions' | 'bots' | undefined)
    workspaceOwnerKey?: string | ((tile: Tile) => string | undefined)
  },
  prefixOverride?: string
) {
  const source = atom<Tile[]>([])
  const prefix = prefixOverride ?? `pane-mirror-scope-${sequence++}`
  cleanupSources.push(source)

  paneMirror<Tile>({
    source,
    key: tile => tile.id,
    prefix,
    minWidth: '10rem',
    title: key => key,
    render: () => null,
    close: () => undefined,
    ...options
  })()

  return {
    prefix,
    source,
    contribution: (id: string) => registry.getArea('panes').find(entry => entry.id === `${prefix}:${id}`)
  }
}

afterEach(() => {
  for (const source of cleanupSources.splice(0)) {
    source.set([])
  }
})

describe('paneMirror workspace scope', () => {
  it('forwards a static workspace mode', () => {
    const mirror = setup({ workspaceMode: 'sessions' })
    mirror.source.set([{ id: 'one' }])

    expect(mirror.contribution('one')).toMatchObject({
      workspaceMode: 'sessions',
      workspaceOwnerKey: undefined
    })
  })

  it('resolves owner callbacks per tile and refreshes an unchanged title', () => {
    const mirror = setup({
      workspaceMode: 'bots',
      workspaceOwnerKey: tile => tile.owner
    })

    mirror.source.set([{ id: 'one', owner: 'connection-a::default' }])
    expect(mirror.contribution('one')?.workspaceOwnerKey).toBe('connection-a::default')

    mirror.source.set([{ id: 'one', owner: 'connection-b::default' }])
    expect(mirror.contribution('one')?.workspaceOwnerKey).toBe('connection-b::default')
  })

  it('leaves existing callers unscoped when options are omitted', () => {
    const mirror = setup({})
    mirror.source.set([{ id: 'one' }])

    expect(mirror.contribution('one')).toMatchObject({
      workspaceMode: undefined,
      workspaceOwnerKey: undefined
    })
  })

  it('keeps an unscoped Browser tile visible in Bot Mode', () => {
    const mirror = setup({})
    mirror.source.set([{ id: 'url:browser' }])

    const pane = mirror.contribution('url:browser')

    expect(contributesToWorkspace(pane, 'sessions')).toBe(true)
    expect(contributesToWorkspace(pane, 'bots', 'bot:connection-a::default')).toBe(true)
  })

  it('hides a Sessions-only Browser tile from Bot Mode', () => {
    const mirror = setup({ workspaceMode: 'sessions' })
    mirror.source.set([{ id: 'url:browser' }])

    const pane = mirror.contribution('url:browser')

    expect(contributesToWorkspace(pane, 'sessions')).toBe(true)
    expect(contributesToWorkspace(pane, 'bots', 'bot:connection-a::default')).toBe(false)
  })
})

describe('paneMirror transient reconciliation', () => {
  it('retains the exact native pane tree while a profile activation temporarily removes its tiles', () => {
    const mirror = setup({}, 'session-tile')
    const tiles = ['B', 'C', 'X'].map(id => ({ id }))
    const pane = (id: string) => `${mirror.prefix}:${id}`

    mirror.source.set(tiles)
    $layoutTree.set(
      split(
        'row',
        [
          group(['workspace', pane('B')], { active: pane('B'), id: 'main', tabStrip: 'always' }),
          group([pane('C'), pane('X')], { active: pane('X'), id: 'side', minimized: true })
        ],
        [7, 3]
      )
    )
    const before = structuredClone($layoutTree.get())

    requestProfileSwitchRestore('beta')
    mirror.source.set([])
    mirror.source.set(tiles)
    expect(focusRetainedSessionPane('X')).toBe(true)

    expect($layoutTree.get()).toEqual(before)
    expect($activeTreeGroup.get()).toBe('side')
    $profileSwitchRestoreIntent.set(null)
  })
})

interface ActivationTile {
  id: string
}

const activationSource = atom<ActivationTile[]>([])
const activate = vi.fn()

paneMirror<ActivationTile>({
  activate,
  close: () => undefined,
  key: tile => tile.id,
  minWidth: '10rem',
  prefix: 'activation-test-tile',
  render: () => null,
  source: activationSource,
  title: id => id
})()

describe('paneMirror activation', () => {
  afterEach(() => {
    activationSource.set([])
    $layoutTree.set(null)
    activate.mockClear()
  })

  it('runs the tile callback only for explicit tab activation', () => {
    activationSource.set([{ id: 'session-a' }])
    $layoutTree.set(group(['workspace', 'activation-test-tile:session-a'], { active: 'workspace', id: 'main' }))

    revealTreePane('activation-test-tile:session-a')
    expect(activate).not.toHaveBeenCalled()

    activateTreePane('main', 'activation-test-tile:session-a')
    expect(activate).toHaveBeenCalledWith('session-a')
  })
})
