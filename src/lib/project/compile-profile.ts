import { z } from 'zod'

export const compileProfileSchema = z.discriminatedUnion('engine', [
  z.object({ engine: z.literal('tectonic'), bibliography: z.literal('auto') }),
  z.object({ engine: z.enum(['pdflatex', 'xelatex']), bibliography: z.enum(['auto', 'bibtex', 'biber', 'none']) }),
  z.object({ engine: z.literal('lualatex'), bibliography: z.literal('auto') }),
])

export type CompileProfile = z.infer<typeof compileProfileSchema>
export const defaultCompileProfile = { engine: 'tectonic', bibliography: 'auto' } satisfies CompileProfile
export const compilerLabels: Record<CompileProfile['engine'], string> = {
  tectonic: 'Tectonic', pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX',
}

export function compileProfileKey(profile?: CompileProfile) {
  const { engine, bibliography } = profile ?? defaultCompileProfile
  return `${engine}:${bibliography}`
}

export function projectCompileUrl(main: string, profile: CompileProfile = defaultCompileProfile) {
  const query = new URLSearchParams({ main, sync: '1' })
  if (profile.engine !== 'tectonic') {
    query.set('engine', profile.engine)
    query.set('bibliography', profile.bibliography)
  }
  return `/api/latex/compile?${query}`
}
