import { z } from 'zod'
import { isProjectPath } from './source-archive'

const path = z.string().max(500).refine(isProjectPath)
export const aiMediaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pdf_page'), path, page: z.number().int().positive(), text: z.string().min(1).max(8000) }),
  z.object({ kind: z.literal('image'), path, mediaType: z.enum(['image/png', 'image/jpeg']),
    data: z.string().min(4).max(880_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
])
export type AiMedia = z.infer<typeof aiMediaSchema>
