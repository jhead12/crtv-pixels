/**
 * u9itus Citizen Reporter handoff.
 *
 * u9itus opens Pixels at `/projects/import?import=<signed manifest URL>` for a
 * report draft. The manifest carries the draft's recording, a bearer token
 * and where to send the finished export. Only manifests from allowed u9itus
 * origins are accepted, and every URL inside must share the manifest's
 * origin, so a crafted link can't redirect a reporter's export elsewhere.
 *
 * Contract: u9itus.dev doc/SITE_BUILDER_AND_CITIZEN_REPORTER.md §2.6.
 */

import { z } from 'zod'

const SESSION_FLAG = 'u9itus:session'
const HANDOFF_PREFIX = 'u9itus:handoff:'
const DEFAULT_ORIGINS = ['https://u9itus.com', 'https://www.u9itus.com']

const manifestSchema = z.object({
  version: z.literal(1),
  handoff: z.string().regex(/^hnd_[a-z0-9]+$/),
  title: z.string().min(1).max(200),
  source: z
    .object({
      headline: z.string(),
      name: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
    })
    .nullable(),
  media: z
    .array(
      z.object({
        url: z.string().url(),
        kind: z.enum(['audio', 'video']),
        mime: z.string().nullable().optional(),
        name: z.string(),
      }),
    )
    .max(10),
  project: z.object({
    width: z.number().int().min(320).max(7680),
    height: z.number().int().min(240).max(4320),
    fps: z.number().int().min(1).max(240),
  }),
  token: z.string().min(20),
  upload: z.object({
    url: z.string().url(),
    method: z.literal('POST'),
    field: z.string().min(1),
    max_bytes: z.number().int().positive(),
    accept: z.array(z.string()),
  }),
  complete_url: z.string().url(),
  return_url: z.string().url(),
  expires_at: z.string(),
})

export type U9itusManifest = z.infer<typeof manifestSchema>

export class U9itusHandoffError extends Error {}

/** Origins allowed to hand projects to this Pixels build (VITE_U9ITUS_ORIGINS, comma separated). */
function allowedOrigins(): string[] {
  const configured = String(import.meta.env.VITE_U9ITUS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  return configured.length > 0 ? configured : DEFAULT_ORIGINS
}

export function isAllowedManifestUrl(url: string, origins = allowedOrigins()): boolean {
  try {
    const parsed = new URL(url)
    return (
      origins.includes(parsed.origin) &&
      (parsed.protocol === 'https:' || parsed.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

/** Every URL the manifest hands us must live on the manifest's own origin. */
function assertSameOrigin(manifest: U9itusManifest, manifestUrl: string): void {
  const origin = new URL(manifestUrl).origin
  const urls = [
    manifest.upload.url,
    manifest.complete_url,
    manifest.return_url,
    ...manifest.media.map((m) => m.url),
  ]
  for (const url of urls) {
    if (new URL(url).origin !== origin) {
      throw new U9itusHandoffError(
        'This link points somewhere other than u9itus, so Pixels won’t use it.',
      )
    }
  }
}

export async function fetchManifest(
  manifestUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<U9itusManifest> {
  if (!isAllowedManifestUrl(manifestUrl)) {
    throw new U9itusHandoffError('This import link isn’t from u9itus.')
  }
  const response = await fetchImpl(manifestUrl, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  })
  if (response.status === 403 || response.status === 410) {
    throw new U9itusHandoffError(
      'This link has expired. Go back to your draft on u9itus and choose Edit in Pixels again.',
    )
  }
  if (!response.ok) {
    throw new U9itusHandoffError(`u9itus didn’t send the draft (HTTP ${response.status}).`)
  }
  const parsed = manifestSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new U9itusHandoffError('u9itus sent a draft this version of Pixels can’t read.')
  }
  assertSameOrigin(parsed.data, manifestUrl)
  return parsed.data
}

/** True for this tab once it was opened from u9itus: browser storage, no wallet, no Director. */
export function isU9itusSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.sessionStorage.getItem(SESSION_FLAG) === '1') return true
  } catch {
    // Storage blocked: fall through to the URL check.
  }
  return (
    window.location.pathname === '/projects/import' &&
    new URLSearchParams(window.location.search).has('import')
  )
}

export function markU9itusSession(): void {
  try {
    window.sessionStorage.setItem(SESSION_FLAG, '1')
  } catch {
    // Without sessionStorage the session lasts only for this page load.
  }
}

/**
 * The workspace for u9itus sessions: a folder in the browser's private
 * storage (OPFS) instead of one the reporter picks, so no folder prompt and
 * no File System Access API is needed.
 */
export async function getU9itusWorkspace(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle('u9itus-workspace', { create: true })
  } catch {
    return null
  }
}

export function saveHandoff(projectId: string, manifest: U9itusManifest): void {
  try {
    window.sessionStorage.setItem(HANDOFF_PREFIX + projectId, JSON.stringify(manifest))
  } catch {
    // Publishing back won't be offered; the reporter can still download.
  }
}

export function getHandoff(projectId: string | null | undefined): U9itusManifest | null {
  if (!projectId || typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_PREFIX + projectId)
    const parsed = raw ? manifestSchema.safeParse(JSON.parse(raw)) : null
    if (!parsed?.success) return null
    return Date.parse(parsed.data.expires_at) > Date.now() ? parsed.data : null
  } catch {
    return null
  }
}

export function clearHandoff(projectId: string): void {
  try {
    window.sessionStorage.removeItem(HANDOFF_PREFIX + projectId)
  } catch {
    // Nothing to clear.
  }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function uploadWithProgress(
  manifest: U9itusManifest,
  blob: Blob,
  fileName: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = new FormData()
    body.append(manifest.upload.field, blob, fileName)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', manifest.upload.url)
    xhr.setRequestHeader('Authorization', `Bearer ${manifest.token}`)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let message = `Upload failed (HTTP ${xhr.status}).`
      try {
        message = JSON.parse(xhr.responseText).message || message
      } catch {
        // Keep the generic message.
      }
      reject(new U9itusHandoffError(message))
    }
    xhr.onerror = () =>
      reject(new U9itusHandoffError('Upload failed. Check your connection and try again.'))
    xhr.send(body)
  })
}

/** Send the finished export to the reporter's draft. Resolves to the draft's edit URL. */
export async function publishToU9itus(
  manifest: U9itusManifest,
  blob: Blob,
  options: { mimeType: string; durationSeconds?: number; onProgress?: (fraction: number) => void },
): Promise<string> {
  if (blob.size > manifest.upload.max_bytes) {
    const limit = Math.floor(manifest.upload.max_bytes / (1024 * 1024))
    throw new U9itusHandoffError(
      `This export is over ${limit} MB. Export at a lower resolution or bitrate.`,
    )
  }
  const mime = (options.mimeType.split(';')[0] ?? '').trim().toLowerCase()
  if (!manifest.upload.accept.includes(mime)) {
    throw new U9itusHandoffError('Export as MP4 or WebM to send it to u9itus.')
  }
  const subtype = mime.split('/')[1] ?? 'mp4'
  const extension = subtype === 'quicktime' ? 'mov' : subtype
  const sha256 = await sha256Hex(blob)
  await uploadWithProgress(manifest, blob, `export.${extension}`, options.onProgress)

  const response = await fetch(manifest.complete_url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${manifest.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sha256,
      seconds: options.durationSeconds
        ? Math.max(1, Math.round(options.durationSeconds))
        : undefined,
    }),
    credentials: 'omit',
  })
  const json = (await response.json().catch(() => ({}))) as { edit_url?: string; message?: string }
  if (!response.ok || !json.edit_url) {
    throw new U9itusHandoffError(
      json.message || `u9itus didn’t accept the video (HTTP ${response.status}).`,
    )
  }
  if (new URL(json.edit_url).origin !== new URL(manifest.complete_url).origin) {
    throw new U9itusHandoffError('u9itus answered with an unexpected link.')
  }
  return json.edit_url
}
