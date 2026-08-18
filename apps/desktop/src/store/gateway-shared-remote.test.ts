import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared-primary routing has two transport shapes. SSH must reuse the primary
// socket because its tunnel/ticket is per-backend. A direct remote gateway can
// safely dial a second `?profile=` WebSocket and must do so for JSON-RPC methods
// that do not carry profile params (Projects). Pooled own-remote/local profiles
// also dial their own socket.

const gatewayMocks = vi.hoisted(() => ({
  connect: vi.fn(async (_wsUrl: string): Promise<void> => {
    throw new Error('dialed a socket for a shared-primary profile')
  }),
  setConnection: vi.fn()
}))

vi.mock('@/hermes', () => ({
  setApiRequestConnection: vi.fn(),
  HermesGateway: class {
    connectionState = 'closed'
    connect = async (wsUrl: string): Promise<void> => {
      await gatewayMocks.connect(wsUrl)
      this.connectionState = 'open'
    }
    close = vi.fn()
    onEvent = vi.fn(() => () => {})
    onState = vi.fn(() => () => {})
  }
}))
vi.mock('@/store/session', () => ({
  setConnection: gatewayMocks.setConnection,
  setGatewayState: vi.fn()
}))
vi.mock('@/store/notify-baseline', () => ({ markNativeNotifyBaseline: vi.fn() }))

const {
  $gateway,
  closeSecondaryGateways,
  configureGatewayRegistry,
  ensureActiveGatewayOpen,
  ensureGatewayForProfile,
  setPrimaryGateway
} = await import('./gateway')

type DesktopStub = { getConnection: ReturnType<typeof vi.fn> }

function installDesktop(stub: DesktopStub): void {
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = stub
}

function makePrimary(): { connectionState: string } {
  // Only connectionState is consulted by setActive/isOpen for these paths.
  return { connectionState: 'open' }
}

beforeEach(() => {
  configureGatewayRegistry({
    onEvent: vi.fn(),
    primaryProfile: 'default'
  } as never)
})

afterEach(() => {
  closeSecondaryGateways()
  vi.clearAllMocks()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('ensureGatewayForProfile under a shared global remote', () => {
  it('activates the primary socket for an SSH shared-primary descriptor', async () => {
    const primary = makePrimary()
    setPrimaryGateway(primary as never, 'default')
    installDesktop({
      // Shared descriptor: primary connection tagged with the profile scope
      // AND the explicit sharedPrimary marker.
      getConnection: vi.fn(async () => ({ mode: 'ssh', port: 4242, profile: 'venture', sharedPrimary: true, token: 't' }))
    })

    await ensureGatewayForProfile('venture')

    expect(gatewayMocks.connect).not.toHaveBeenCalled()
    expect($gateway.get()).toBe(primary)
  })

  it('dials a profile-scoped socket for a direct remote shared-primary descriptor', async () => {
    const primary = makePrimary()
    const remoteWsUrl = 'wss://remote.invalid/api/ws?token=fake-test-token&profile=venture'

    setPrimaryGateway(primary as never, 'default')
    installDesktop({
      getConnection: vi.fn(async () => ({
        authMode: 'token',
        baseUrl: 'https://remote.invalid',
        mode: 'remote',
        profile: 'venture',
        sharedPrimary: true,
        token: 'fake-test-token',
        wsUrl: remoteWsUrl
      }))
    })
    gatewayMocks.connect.mockResolvedValueOnce(undefined)

    await ensureGatewayForProfile('venture')

    expect(gatewayMocks.connect).toHaveBeenCalledOnce()
    expect(gatewayMocks.connect).toHaveBeenCalledWith(remoteWsUrl)
    expect($gateway.get()).not.toBe(primary)
  })

  it('dials the exact WebSocket URL for a pooled profile descriptor that carries profile', async () => {
    const primary = makePrimary()
    const remoteWsUrl = 'wss://remote.invalid/api/ws?token=fake-test-token'

    setPrimaryGateway(primary as never, 'default')
    installDesktop({
      // Pooled descriptor: carries `profile` for WS URL minting but is NOT
      // shared-primary (no marker) — it must dial its own socket, not reuse
      // the primary. This is the local named / own-remote profile case.
      getConnection: vi.fn(async () => ({
        authMode: 'token',
        baseUrl: 'https://remote.invalid',
        mode: 'remote',
        profile: 'worker',
        token: 'fake-test-token',
        wsUrl: remoteWsUrl
      }))
    })
    gatewayMocks.connect.mockResolvedValueOnce(undefined)

    await ensureGatewayForProfile('worker')

    expect(gatewayMocks.connect).toHaveBeenCalledOnce()
    expect(gatewayMocks.connect).toHaveBeenCalledWith(remoteWsUrl)
    expect($gateway.get()).not.toBe(primary)
  })

  it('refreshes the active connection after a pooled profile reconnect succeeds', async () => {
    const connection = {
      authMode: 'token',
      baseUrl: 'https://worker.invalid',
      mode: 'remote',
      profile: 'worker',
      token: 'fake-test-token',
      wsUrl: 'wss://worker.invalid/api/ws?token=fake-test-token'
    }

    const getConnection = vi.fn(async () => connection)

    setPrimaryGateway(makePrimary() as never, 'default')
    installDesktop({ getConnection })

    gatewayMocks.connect.mockRejectedValueOnce(new Error('temporarily offline')).mockResolvedValueOnce(undefined)

    await ensureGatewayForProfile('worker')

    expect(gatewayMocks.setConnection).toHaveBeenCalledOnce()
    expect(gatewayMocks.setConnection).toHaveBeenLastCalledWith(connection)

    await ensureActiveGatewayOpen()

    expect(gatewayMocks.setConnection).toHaveBeenCalledTimes(2)
    expect(gatewayMocks.setConnection).toHaveBeenLastCalledWith(connection)
  })
})
