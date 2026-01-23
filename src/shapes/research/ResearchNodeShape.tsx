import { TLBaseShape } from 'tldraw'
import type { ResearchNodeType } from '@/app/research/research-node'

export type ResearchNodeShape = TLBaseShape<
    'research-node',
    {
        section: ResearchNodeType
        content: string
        order: number
    }
>
