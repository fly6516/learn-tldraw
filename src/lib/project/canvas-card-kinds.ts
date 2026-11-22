import { latexBlockNames } from './latex-block-kinds'

export const researchCardKinds = ['question', 'hypothesis', 'evidence', 'note', 'review', 'task', 'custom'] as const
export type ResearchCardKind = typeof researchCardKinds[number]
export const researchCardNames: Record<ResearchCardKind, string> = {
  question: 'Research question',
  hypothesis: 'Hypothesis',
  evidence: 'Evidence',
  note: 'Note',
  review: 'Review comment',
  task: 'To-do',
  custom: 'Custom card',
}

export const researchCardStatuses = ['open', 'in progress', 'done'] as const

export const canvasResourceNames = {
  ...latexBlockNames,
  image: 'Image',
  bibliography: 'Bibliography entry',
  dataset: 'Dataset',
  attachment: 'Attachment',
  research: 'Research card',
}

export function materialKind(path: string) {
  if (/\.(tex|bib)$/i.test(path)) return undefined
  if (/\.(csv|tsv|jsonl?|ndjson|xlsx?|parquet|feather|rds|dta|sav|mat|arrow|h5|nc|geojson)$/i.test(path)) return 'dataset'
  if (/\.(png|jpe?g|webp|gif)$/i.test(path)) return 'image'
  return 'attachment'
}
