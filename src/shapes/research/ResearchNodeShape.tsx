import { TLBaseShape } from 'tldraw'
import type { ResearchNodeType } from '@/app/research/research-node'

export type ResearchNodeShape = TLBaseShape<
    'research-node',
    {
        section: ResearchNodeType
        content: string
        order: number
        level: number
        parentId?: string
        customLabel?: string
        tags?: string[]
        metadata?: {
            originalTitle?: string
            sectionNumber?: string
            imported?: boolean
            importSource?: string
            createdAt?: string
            updatedAt?: string
        }
    }
>
