import { z } from 'zod'
import { isProjectPath } from './source-archive'
import { publisherArticleIds } from './publisher-article'
import { additionalWordThesisIds } from './official-thesis-front'
import { wordLayoutSchema } from './word-layout'

const common = {
  selectionId: z.string().uuid(),
  origin: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }),
  name: z.string().min(1),
  main: z.string().refine(value => isProjectPath(value) && /^[\w.-]+\.tex$/.test(value)),
}
const fields = z.object({
  affiliation: z.string().max(160), email: z.string().max(160), advisor: z.string().max(160), studentNumber: z.string().max(160),
  program: z.string().max(160), date: z.string().max(160), chineseTitle: z.string().max(80),
  chineseAbstract: z.string().max(6000), chineseKeywords: z.string().max(160), declarations: z.boolean(),
})

const documentBytes = z.string().min(1).max(22 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/)

export const activeTemplateSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common, kind: z.literal('jmlr-article'), fields: fields.pick({ affiliation: true, email: true }),
    documentClass: z.string().regex(/^[\w-]+$/), options: z.array(z.string().regex(/^[\w-]+$/)),
    packageName: z.string().regex(/^[\w-]+$/), style: z.string().min(1).max(1024 * 1024),
  }),
  z.object({
    ...common, kind: z.literal('zju-undergraduate'), fields: fields.omit({ email: true }),
    layout: wordLayoutSchema, guidelineSha256: z.string().regex(/^[a-f0-9]{64}$/),
    word: documentBytes,
  }),
  z.object({
    ...common, kind: z.literal('suep-undergraduate'),
    fields: fields.omit({ email: true, declarations: true }),
    cover: documentBytes, declaration: documentBytes,
    coverFieldsSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    coverSha256: z.string().regex(/^[a-f0-9]{64}$/), declarationSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    ...common, kind: z.literal('sjtu-graduate-word'),
    fields: fields.omit({ email: true }).extend({ englishAdvisor: z.string().max(160), englishAffiliation: z.string().max(160) }),
    layout: wordLayoutSchema, word: documentBytes,
  }),
  z.object({
    ...common, kind: z.literal('njupt-masters'), fields: fields.omit({ email: true }).extend({
      englishAdvisor: z.string().max(160), direction: z.string().max(160).optional(), degree: z.string().max(80), englishDegree: z.string().max(80),
      studyMode: z.enum(['full-time', 'part-time']).optional(),
    }),
    layout: wordLayoutSchema, word: documentBytes, declaration: documentBytes.optional(),
    declarationSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    blindCover: documentBytes.optional(), blindCoverSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }),
  z.object({
    ...common, kind: z.literal('official-thesis'), variant: z.enum(additionalWordThesisIds),
    fields: fields.omit({ email: true }).extend({
      englishAdvisor: z.string().max(160).optional(), englishAffiliation: z.string().max(160).optional(),
      direction: z.string().max(160).optional(), degree: z.string().max(80).optional(), englishProgram: z.string().max(160).optional(),
      track: z.enum(['academic', 'professional']), classification: z.string().max(80).optional(),
      udc: z.string().max(80).optional(), confidentiality: z.string().max(80).optional(),
    }),
    layout: wordLayoutSchema, word: documentBytes,
  }),
  z.object({
    ...common, kind: z.literal('thuthesis'),
    fields: fields.pick({ chineseTitle: true, chineseAbstract: true, chineseKeywords: true, advisor: true, program: true, date: true, affiliation: true })
      .extend({ englishAdvisor: z.string().max(160), englishProgram: z.string().max(160), degree: z.enum(['bachelor', 'master', 'doctor']),
        degreeTitle: z.string().max(80).optional(), englishDegree: z.string().max(160).optional() }),
    styles: z.object({
      'thuthesis.cls': z.string().min(1).max(1024 * 1024), 'thuthesis-numeric.bst': z.string().min(1).max(1024 * 1024),
    }),
    logos: z.object({ 'thu-fig-logo.pdf': documentBytes, 'thu-text-logo.pdf': documentBytes }),
  }),
  z.object({
    ...common, kind: z.literal('starter-article'), variant: z.enum(['english-article', 'chinese-article']),
    fields: fields.pick({}),
  }),
  z.object({
    ...common, kind: z.literal('mit-thesis'), style: z.string().min(1).max(1024 * 1024),
    fields: fields.pick({ affiliation: true, advisor: true, date: true }).extend({
      degree: z.string().min(1).max(80), advisorTitle: z.string().min(1).max(160),
      acceptor: z.string().min(1).max(160), acceptorTitle: z.string().min(1).max(160),
      acceptorRole: z.string().min(1).max(160), degreeDate: z.string().regex(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/),
    }),
  }),
  z.object({
    ...common, kind: z.literal('publisher-article'), variant: z.enum(publisherArticleIds),
    fields: fields.pick({ affiliation: true, email: true }).extend({
      keyPoint: z.string().max(140).optional(), keyPoint2: z.string().max(140).optional(), keyPoint3: z.string().max(140).optional(), plainLanguageSummary: z.string().max(2400).optional(), openResearch: z.string().max(1200).optional(),
    }),
    artwork: z.record(z.string().regex(/^[\w.-]+\.pdf$/), documentBytes).optional(),
    styles: z.record(z.string().regex(/^[\w.-]+\.(?:cls|rtx|bst|sty|def)$/), z.string().min(1).max(1024 * 1024)),
    preamble: z.string().max(100_000).optional(),
  }),
  z.object({
    ...common, kind: z.literal('prl-article'), fields: fields.pick({ affiliation: true, email: true }),
    styles: z.record(z.string().regex(/^[\w.-]+\.(?:cls|rtx|bst|sty|def)$/), z.string().min(1).max(1024 * 1024)),
  }),
])
export type ActiveTemplate = z.infer<typeof activeTemplateSchema>
export type TemplateFields = z.infer<typeof fields> & { englishAdvisor?: string; englishAffiliation?: string; direction?: string; degree?: string; englishDegree?: string; degreeTitle?: string; englishProgram?: string; track?: 'academic' | 'professional'; classification?: string; udc?: string; confidentiality?: string; advisorTitle?: string; acceptor?: string; acceptorTitle?: string; acceptorRole?: string; degreeDate?: string; studyMode?: 'full-time' | 'part-time'; keyPoint?: string; keyPoint2?: string; keyPoint3?: string; plainLanguageSummary?: string; openResearch?: string }

export function activeTemplateEngine(template: ActiveTemplate) {
  if (template.kind === 'mit-thesis') return 'lualatex'
  if (template.kind === 'starter-article' && template.variant === 'english-article') return 'pdflatex'
  return template.kind === 'jmlr-article' || template.kind === 'prl-article' || template.kind === 'publisher-article' ? 'pdflatex' : 'xelatex'
}
