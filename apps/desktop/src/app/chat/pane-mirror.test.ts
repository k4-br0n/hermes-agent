import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { group } from '@/components/pane-shell/tree/model'
import { $layoutTree, activateTreePane, revealTreePane } from '@/components/pane-shell/tree/store'

import { paneMirror } from './pane-mirror'

interface TestTile {
  id: string
}

const source = atom<TestTile[]>([])
const activate = vi.fn()

paneMirror<TestTile>({
  activate,
  close: () => undefined,
  key: tile => tile.id,
  minWidth: '10rem',
  prefix: 'test-tile',
  render: () => null,
  source,
  title: id => id
})()

describe('paneMirror activation', () => {
  afterEach(() => {
    source.set([])
    $layoutTree.set(null)
    activate.mockClear()
  })

  it('runs the tile callback only for explicit tab activation', () => {
    source.set([{ id: 'session-a' }])
    $layoutTree.set(group(['workspace', 'test-tile:session-a'], { active: 'workspace', id: 'main' }))

    revealTreePane('test-tile:session-a')
    expect(activate).not.toHaveBeenCalled()

    activateTreePane('main', 'test-tile:session-a')
    expect(activate).toHaveBeenCalledWith('session-a')
  })
})
