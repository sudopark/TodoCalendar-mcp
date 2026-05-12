// emulator readiness probe. base URL의 host:port에 TCP connect 시도.
// 안 떠 있으면 통합 테스트 skip — 실수로 실 서버를 때리지 않기 위함.

import net from 'node:net'

const probe = async (host: string, port: number, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, host)
  })

// emulator cold start·CPU 압박 상태에서 1회 probe가 false negative로 흐르는 케이스 대응.
// 1회 retry — 정상 케이스엔 ms 단위로 끝나므로 추가 비용 없음, 부하 상태에서만 한 번 더 기회.
const probeWithRetry = async (
  host: string,
  port: number,
  timeoutMs: number,
  retries: number,
): Promise<boolean> => {
  for (let i = 0; i <= retries; i++) {
    if (await probe(host, port, timeoutMs)) return true
  }
  return false
}

export const emulatorReadyOrSkipReason = async (
  baseUrl: string,
  timeoutMs = 1000,
  retries = 1,
): Promise<string | undefined> => {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return `OPENAPI_BASE_URL is not a valid URL: ${baseUrl}`
  }
  const port = url.port !== '' ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  const ok = await probeWithRetry(url.hostname, port, timeoutMs, retries)
  if (ok) return undefined
  return `Emulator not reachable at ${url.hostname}:${port}. Start TodoCalendar-Functions emulator (firebase emulators:start) and retry.`
}
