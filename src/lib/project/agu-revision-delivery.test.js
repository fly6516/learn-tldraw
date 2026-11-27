import { expect, test } from 'bun:test'
import { aguReplySource, validAguMarkedFile, verifyAguDelivery } from './agu-revision-delivery'
import { templateDigest } from './paper-templates'

test('renders response and evidence as literal LaTeX text', () => {
  const source = aguReplySource({
    binding: { roundName: 'Calibration & method', original: { name: 'Original' }, revised: { name: 'Clean revision' } },
    letter: { entries: [{ heading: 'Comment 1 · Editor', comment: 'Review <5%>.',
      disposition: 'Response', reply: String.raw`We kept \input{example} as literal text.`,
      evidence: ['Modified · sections/results.tex (revised L12)'] }] },
  })
  expect(source).toContain(String.raw`Review \textless{}5\%\textgreater{}.`)
  expect(source).toContain(String.raw`\textbackslash{}input\{example\}`)
  expect(source).toContain('sections/results.tex (revised L12)')
})

test('rejects counterfeit markups and modified saved ZIP bytes', async () => {
  const archive = new Blob(['original-zip'])
  const sha256 = await templateDigest(await archive.arrayBuffer())
  expect(await verifyAguDelivery({ archive, sha256, bytes: archive.size })).toBe(true)
  expect(await verifyAguDelivery({ archive: new Blob(['modified-zip']), sha256, bytes: archive.size })).toBe(false)
  expect(await validAguMarkedFile('tracked.pdf', new Blob(['not a pdf']))).toBe(false)
  expect(await validAguMarkedFile('tracked.docx', new Blob(['PKzip']))).toBe(false)
})
