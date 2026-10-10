/**
 * "Send to u9itus" on the export-complete screen, shown only when the
 * current project came from a u9itus Citizen Reporter handoff. Uploads the
 * finished (C2PA-signed when signing is configured) export to the
 * reporter's draft and sends them back to it.
 */

import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { clearHandoff, getHandoff, publishToU9itus, U9itusHandoffError } from './handoff'

interface SendToU9itusButtonProps {
  projectId: string | null | undefined
  result: { blob: Blob; mimeType: string; duration: number } | null
}

export function SendToU9itusButton({ projectId, result }: SendToU9itusButtonProps) {
  const [progress, setProgress] = useState<number | null>(null)
  const handoff = getHandoff(projectId)
  if (!handoff || !result || !projectId) return null

  const send = async () => {
    setProgress(0)
    try {
      const editUrl = await publishToU9itus(handoff, result.blob, {
        mimeType: result.mimeType,
        durationSeconds: result.duration,
        onProgress: setProgress,
      })
      clearHandoff(projectId)
      toast.success('Sent to your u9itus draft')
      window.location.assign(editUrl)
    } catch (error) {
      setProgress(null)
      toast.error(
        error instanceof U9itusHandoffError
          ? error.message
          : 'Sending to u9itus failed. Try again.',
      )
    }
  }

  return (
    <Button onClick={send} disabled={progress !== null}>
      {progress === null ? (
        <Send className="mr-2 h-4 w-4" />
      ) : (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      )}
      {progress === null ? 'Send to u9itus' : `Sending… ${Math.round(progress * 100)}%`}
    </Button>
  )
}
