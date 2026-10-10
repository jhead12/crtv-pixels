/**
 * Landing screen for a u9itus Citizen Reporter handoff: reads the signed
 * manifest, creates a project in browser storage, imports the draft's
 * recording and opens the editor. The gate has already switched this tab to
 * the u9itus workspace (see workspace-gate).
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/shared/logging/logger'
import { useProjectStore } from './deps/projects-contract'
import { mediaLibraryService } from './deps/media-library-contract'
import { fetchManifest, markU9itusSession, saveHandoff, U9itusHandoffError } from './handoff'

const logger = createLogger('U9itusImport')

type Step = 'manifest' | 'project' | 'media' | 'error'

export function U9itusImport({ manifestUrl }: { manifestUrl: string }) {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('manifest')
  const [error, setError] = useState<string | null>(null)
  const [returnUrl, setReturnUrl] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      const manifest = await fetchManifest(manifestUrl)
      // Only a valid u9itus manifest switches this tab to u9itus mode.
      markU9itusSession()
      setReturnUrl(manifest.return_url)

      setStep('project')
      const project = await useProjectStore.getState().createProject({
        name: manifest.title.slice(0, 100),
        description: manifest.source
          ? `Responding to: ${manifest.source.headline}`.slice(0, 500)
          : '',
        width: manifest.project.width,
        height: manifest.project.height,
        fps: manifest.project.fps,
      })
      saveHandoff(project.id, manifest)

      setStep('media')
      for (const media of manifest.media) {
        await mediaLibraryService.importMediaFromUrl(media.url, project.id)
      }
      // Drop the one-time link from the address bar and history.
      navigate({ to: '/editor/$projectId', params: { projectId: project.id }, replace: true })
    })().catch((err: unknown) => {
      logger.error('u9itus import failed', err)
      setError(
        err instanceof U9itusHandoffError
          ? err.message
          : 'Pixels couldn’t open this draft. Try again from u9itus.',
      )
      setStep('error')
    })
  }, [manifestUrl, navigate])

  const label = {
    manifest: 'Opening your draft from u9itus…',
    project: 'Creating a project…',
    media: 'Bringing in your recording…',
    error: '',
  }[step]

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-sm font-semibold text-foreground">u9itus Citizen Reporter</h1>
        {step !== 'error' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            {label}
          </p>
        ) : (
          <>
            <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
            {returnUrl && (
              <Button variant="outline" onClick={() => window.location.assign(returnUrl)}>
                Back to the draft
              </Button>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Your project stays in this browser. When you’re done, export and choose Send to u9itus.
        </p>
      </div>
    </div>
  )
}
