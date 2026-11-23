import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { isLocalResearchTest } from '@/lib/project/test-mode'
import { TestWorkspace } from './workspace'

export default async function ResearchTestPage() {
  if (!isLocalResearchTest((await headers()).get('host'))) notFound()
  return <TestWorkspace />
}
