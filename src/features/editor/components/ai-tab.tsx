import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clapperboard, Layers, Sparkles, WandSparkles } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { isSeedanceGenerateEnabled } from '@/config/seedance'
import { AiPanel } from './ai-panel'
import { DirectorChatPanel } from '../director'
import { FlowPanel } from '../flow'
import { SeedancePanel } from '../seedance'
import { isU9itusSession } from '../deps/u9itus-contract'

type AiTabMode = 'generate' | 'pixels' | 'flow' | 'director'

/**
 * AI sidebar: local Generate (TTS/music), paid Flow (start/end → video),
 * and paid Creative Director. Tabs opened from a u9itus Citizen Reporter
 * handoff don't offer the Director.
 */
export const AiTab = memo(function AiTab() {
  const { t } = useTranslation()
  const seedanceEnabled = isSeedanceGenerateEnabled()
  const [mode, setMode] = useState<AiTabMode>('generate')
  const directorEnabled = !isU9itusSession()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border p-1.5">
        <button
          type="button"
          onClick={() => setMode('generate')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors sm:gap-1.5 sm:text-[11px]',
            mode === 'generate'
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
          )}
        >
          <WandSparkles className="h-3 w-3 opacity-70" />
          {t('director.tab.generate', { defaultValue: 'Generate' })}
        </button>
        {seedanceEnabled && (
          <button
            type="button"
            onClick={() => setMode('pixels')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors sm:gap-1.5 sm:text-[11px]',
              mode === 'pixels'
                ? 'bg-primary/15 text-primary ring-1 ring-primary/35'
                : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
            )}
          >
            <Sparkles className="h-3 w-3 opacity-80" strokeWidth={1.75} />
            {t('director.tab.pixels', { defaultValue: 'Pixels' })}
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode('flow')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors sm:gap-1.5 sm:text-[11px]',
            mode === 'flow'
              ? 'bg-primary/15 text-primary ring-1 ring-primary/35'
              : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
          )}
        >
          <Layers className="h-3 w-3 opacity-80" strokeWidth={1.75} />
          {t('director.tab.flow', { defaultValue: 'Flow' })}
        </button>
        {directorEnabled && (
          <button
            type="button"
            onClick={() => setMode('director')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors sm:gap-1.5 sm:text-[11px]',
              mode === 'director'
                ? 'bg-primary/15 text-primary ring-1 ring-primary/35'
                : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
            )}
          >
            <Clapperboard className="h-3 w-3 opacity-80" strokeWidth={1.75} />
            {t('director.tab.director', { defaultValue: 'Director' })}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'generate' ? (
          <AiPanel />
        ) : mode === 'pixels' && seedanceEnabled ? (
          <SeedancePanel />
        ) : mode === 'flow' ? (
          <FlowPanel />
        ) : directorEnabled ? (
          <DirectorChatPanel />
        ) : (
          <AiPanel />
        )}
      </div>
    </div>
  )
})
