import { ResearchWorkspace } from '@/components/research/ResearchWorkspace'
import { sampleCanvas } from './sample'

export default function SamplePaperPage() {
  return <ResearchWorkspace sample={sampleCanvas()} />
}
