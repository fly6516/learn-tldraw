import { Suspense } from 'react'
import { ProjectLibrary } from '@/components/research/ProjectLibrary'

export default function ResearchPage() {
  return <Suspense fallback={<p role="status">Opening local projects…</p>}><ProjectLibrary /></Suspense>
}
