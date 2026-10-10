import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  fetchManifest,
  getHandoff,
  isAllowedManifestUrl,
  publishToU9itus,
  saveHandoff,
  sha256Hex,
  U9itusHandoffError,
  type U9itusManifest,
} from './handoff'

const ORIGIN = 'https://u9itus.com'

function manifest(overrides: Partial<U9itusManifest> = {}): U9itusManifest {
  return {
    version: 1,
    handoff: 'hnd_abc123',
    title: 'Flooded underpass',
    source: { headline: 'Storm floods Main St', name: 'Daily', url: 'https://news.example/x' },
    media: [
      {
        url: `${ORIGIN}/api/v1/pixels/handoffs/hnd_abc123/media?signature=x`,
        kind: 'video',
        mime: 'video/webm',
        name: 'take.webm',
      },
    ],
    project: { width: 1080, height: 1920, fps: 30 },
    token: 'a'.repeat(48),
    upload: {
      url: `${ORIGIN}/api/v1/pixels/handoffs/hnd_abc123/upload`,
      method: 'POST',
      field: 'file',
      max_bytes: 1024,
      accept: ['video/mp4', 'video/webm'],
    },
    complete_url: `${ORIGIN}/api/v1/pixels/handoffs/hnd_abc123/complete`,
    return_url: `${ORIGIN}/voter/reports/flooded/edit`,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('u9itus handoff', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('only accepts manifests from u9itus origins', () => {
    expect(isAllowedManifestUrl(`${ORIGIN}/api/v1/pixels/handoffs/hnd_a/manifest`)).toBe(true)
    expect(isAllowedManifestUrl('https://evil.example/manifest')).toBe(false)
    expect(isAllowedManifestUrl('http://u9itus.com/manifest')).toBe(false)
    expect(isAllowedManifestUrl('not a url')).toBe(false)
  })

  it('reads a valid manifest', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(manifest()))
    const result = await fetchManifest(
      `${ORIGIN}/api/v1/pixels/handoffs/hnd_abc123/manifest?signature=x`,
      fetchImpl as typeof fetch,
    )
    expect(result.title).toBe('Flooded underpass')
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/manifest'),
      expect.objectContaining({ credentials: 'omit' }),
    )
  })

  it('refuses manifests that send the export to another origin', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        manifest({ upload: { ...manifest().upload, url: 'https://evil.example/upload' } }),
      ),
    )
    await expect(fetchManifest(`${ORIGIN}/m`, fetchImpl as typeof fetch)).rejects.toBeInstanceOf(
      U9itusHandoffError,
    )
  })

  it('explains expired links', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Invalid signature.' }, 403))
    await expect(fetchManifest(`${ORIGIN}/m`, fetchImpl as typeof fetch)).rejects.toThrow(/expired/)
  })

  it('keeps the handoff per project for this tab only, until it expires', () => {
    saveHandoff('p1', manifest())
    expect(getHandoff('p1')?.handoff).toBe('hnd_abc123')
    expect(getHandoff('p2')).toBeNull()
    saveHandoff('p3', manifest({ expires_at: new Date(Date.now() - 1000).toISOString() }))
    expect(getHandoff('p3')).toBeNull()
  })

  it('checks size and type before uploading', async () => {
    await expect(
      publishToU9itus(manifest(), new Blob([new Uint8Array(2048)]), { mimeType: 'video/mp4' }),
    ).rejects.toThrow(/over/)
    await expect(
      publishToU9itus(manifest(), new Blob(['x']), { mimeType: 'image/gif' }),
    ).rejects.toThrow(/MP4 or WebM/)
  })

  it('uploads with the token, completes with the hash and returns the draft link', async () => {
    const sent: { url?: string; auth?: string } = {}
    class FakeXhr {
      status = 200
      responseText = '{}'
      upload = {
        onprogress: null as
          | null
          | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void),
      }
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      open(_method: string, url: string) {
        sent.url = url
      }
      setRequestHeader(name: string, value: string) {
        if (name === 'Authorization') sent.auth = value
      }
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 })
        this.onload?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const blob = new Blob(['video-bytes'], { type: 'video/mp4' })
    // jsdom's Blob has no arrayBuffer(); browsers do.
    Object.defineProperty(blob, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('video-bytes').buffer,
    })
    const fetchMock = vi.fn(async () =>
      jsonResponse({ edit_url: `${ORIGIN}/voter/reports/flooded/edit` }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const progress = vi.fn()

    const editUrl = await publishToU9itus(manifest(), blob, {
      mimeType: 'video/mp4;codecs=avc1',
      durationSeconds: 41.6,
      onProgress: progress,
    })

    expect(editUrl).toBe(`${ORIGIN}/voter/reports/flooded/edit`)
    expect(sent).toEqual({ url: manifest().upload.url, auth: `Bearer ${'a'.repeat(48)}` })
    expect(progress).toHaveBeenCalledWith(1)
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    )
    expect(body).toEqual({ sha256: await sha256Hex(blob), seconds: 42 })
  })
})
