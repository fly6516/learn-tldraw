export const latexBlockKinds = ['figure', 'table', 'equation', 'algorithm', 'listing', 'theorem', 'environment'] as const
export type LatexBlockKind = typeof latexBlockKinds[number]

export const latexBlockNames: Record<LatexBlockKind, string> = {
  figure: 'Figure',
  table: 'Table',
  equation: 'Formula',
  algorithm: 'Algorithm',
  listing: 'Code listing',
  theorem: 'Theorem or proof',
  environment: 'LaTeX environment',
}
