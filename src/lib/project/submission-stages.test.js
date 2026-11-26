import { expect, test } from 'bun:test'
import { assessSubmissionStage, blindDeliveryBlocked, omitBlindAcknowledgments } from './submission-stages'

test('blind rendering removes a structured acknowledgment and preserves source lines', () => {
  const source = String.raw`\section{Results}
Keep this result.
\subsection*{Acknowledgements}
Remove the author's identity here.
\subsubsection{Funding}
Its details may also identify the author.
\section{Discussion}
Keep this discussion.`
  const result = omitBlindAcknowledgments(source)
  expect(result).toHaveLength(source.length)
  expect(result.split('\n')[1]).toBe('Keep this result.')
  expect(result.split('\n')[7]).toBe('Keep this discussion.')
  expect(result).not.toContain('identify the author')
})

test('known identities in rendered text or asset names prevent blind delivery', () => {
  const stages = (files, text, coverVerified = true) => assessSubmissionStage({ files: new Map(files) }, 'main.tex', 'njupt-blind',
    [{ text }], true, { coverVerified, identifiers: ['Casey Lin', '20260001'] })
  const main = [['main.tex', { type: 'file', content: 'The calibration results.' }]]
  expect(blindDeliveryBlocked('njupt-blind', stages(main, 'Anonymous cover'))).toBe(false)
  expect(blindDeliveryBlocked('njupt-blind', stages(main, 'Casey L i n'))).toBe(true)
  expect(blindDeliveryBlocked('njupt-blind', stages([...main, ['figures/20260001.png', { type: 'file' }]], 'Anonymous cover'))).toBe(true)
  expect(blindDeliveryBlocked('njupt-blind', stages(main, '独 创 性 声 明'))).toBe(true)
  expect(blindDeliveryBlocked('njupt-blind', stages(main, 'Anonymous cover', false))).toBe(true)
})

test('AGU revision reports absent key points and detects marked LaTeX', () => {
  const content = String.raw`\keypoints{First}{}{}
\begin{plainlanguagesummary}A clear summary.\end{plainlanguagesummary}
\section*{Open Research Statement}
Data available from the archive.
\added{This source still has tracked changes.}`
  const findings = assessSubmissionStage({ files: new Map([['main.tex', { type: 'file', content }]]) },
    'main.tex', 'agu-revision', [], false)
  expect(findings.find(rule => rule.ruleId === 'agu-key-points')).toMatchObject({ status: 'issue', path: 'main.tex', line: 1 })
  expect(findings.find(rule => rule.ruleId === 'agu-clean-revision')).toMatchObject({ status: 'issue', line: 5 })
  expect(findings.find(rule => rule.ruleId === 'agu-review-response')).toMatchObject({ status: 'manual' })
})
