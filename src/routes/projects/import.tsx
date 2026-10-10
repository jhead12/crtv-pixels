import { createFileRoute } from '@tanstack/react-router'
import { U9itusImport } from '@/features/u9itus/u9itus-import'

/** Entry point for u9itus Citizen Reporter handoffs: /projects/import?import=<signed manifest URL>. */
export const Route = createFileRoute('/projects/import')({
  validateSearch: (search: Record<string, unknown>) => ({
    import: typeof search.import === 'string' ? search.import : '',
  }),
  component: ImportRoute,
})

function ImportRoute() {
  const { import: manifestUrl } = Route.useSearch()
  return <U9itusImport manifestUrl={manifestUrl} />
}
