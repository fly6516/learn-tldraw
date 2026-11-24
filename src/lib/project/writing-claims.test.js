import { expect, test } from 'bun:test'
import { assessClaim, claimEvidenceFor, collectWritingClaims } from './writing-claims'
import { captureEvidenceQuote } from './writing-ai-evidence'

test('checks mirrored groups, units and causal wording against observed CSV columns', () => {
  const ref = { path: 'data/sessions.csv', line: 2, text: '["1","28.1","30.7"]', kind: 'data',
    csvHeader: ['session', 'shaded_c', 'exposed_c'] }
  const choice = { path: ref.path, line: ref.line }
  const check = (quote, column) => claimEvidenceFor(quote, [{ ...choice, column }], [ref]).needsConfirmation
  expect(check('The shaded route measured 28.1 degrees Celsius.')).toBe(false)
  expect(check('The shaded route measured 30.7 degrees Celsius.', 'exposed_c')).toBe(true)
  expect(check('The shaded route measured 28.1 degrees Fahrenheit.', 'shaded_c')).toBe(true)
  expect(check('遮阴道路实测 30.7 摄氏度。', 'exposed_c')).toBe(true)
  expect(check('The shaded route measured 28.1\\,\\textdegree{}F.', 'shaded_c')).toBe(true)
  expect(check('Shade caused the temperature to drop.')).toBe(true)
  const claims = collectWritingClaims([{ path: 'main.tex', before: 'Shade was linked to cooler temperatures.',
    after: 'Shade caused cooler temperatures.' }], [], [], [])
  expect(claims[0]).toMatchObject({ needsConfirmation: true })
})

test('keeps claims next to exact replacement text and accepts only evidence actually read', () => {
  const path = 'sections/results.tex'
  const supported = 'The first session measured 28.1 degrees.'
  const unresolved = 'A follow-up measured 31.7 degrees.'
  const unrelated = 'The baseline measured 25.0 degrees.'
  const unsupported = 'The unexplained change was statistically significant.'
  const edits = [{ path, before: unrelated, after: [unrelated, supported, unresolved, unsupported].join('\n') }]
  const observed = [{ path: 'data/sessions.csv', line: 2, text: '["1","28.1"]', kind: 'data' }]
  const claims = collectWritingClaims(edits, [
    { path: 'data/sessions.csv', quote: supported, references: [{ path: 'data/sessions.csv', line: 2 }, { path: 'data/sessions.csv', line: 9 }] },
    { path, quote: unresolved, references: [{ path: 'data/sessions.csv', line: 2 }] },
    { path, quote: 'Not part of the edit.', references: [] },
  ], observed, [])
  expect(claims).toMatchObject([
    { path, quote: supported, kind: 'claim', references: observed, needsConfirmation: false },
    { path, quote: unresolved, kind: 'claim', references: observed, needsConfirmation: true },
    { path, quote: unsupported, kind: 'claim', references: [] },
  ])
  expect(claims[0].exclusion).toEqual({ before: supported + '\n', after: '' })
})

test('reopens only the review whose referenced record or exact wording changed', () => {
  const path = 'data/test.csv'
  const results = 'results.tex'
  const data = 'x,y\n1,28.1\n2,27.5'
  const claims = ['First value was 28.1.', 'Second value was 27.5.'].map((quote, index) => ({
    quote, kind: 'claim', path: results, references: [{
      path, line: index + 2, kind: 'data', text: JSON.stringify([String(index + 1), ['28.1', '27.5'][index]]),
      anchor: captureEvidenceQuote(path, data, index + 2),
    }],
  }))
  const project = (csv, contents = claims.map(claim => claim.quote).join('\n')) => ({ files: new Map([
    [path, { path, content: csv }], [results, { path: results, content: contents }],
  ]) })
  const decisions = claims.map(claim => ({ decision: 'confirmed', fingerprint: assessClaim(claim, project(data), [], 0).fingerprint }))
  expect(claims.map((claim, i) => assessClaim(claim, project('extra,heading\n' + data), [], 0, decisions[i]).confirmed)).toEqual([true, true])
  expect(claims.map((claim, i) => assessClaim(claim, project(data.replace('28.1', '28.2')), [], 0, decisions[i]).confirmed)).toEqual([false, true])
  expect(assessClaim(claims[0], project(data, 'First value was around 28.'), [], 0, decisions[0]).needsReview).toBe(true)
})

test('links a unique bibliography entry and flags unresolved citation keys', () => {
  const edits = [{ path: 'results.tex', before: 'Text.', after: 'Text. \\cite{known,missing}' }]
  const sources = [{ path: 'refs.bib', source: '@book{known, title={Calibration Guide}}' }]
  const claims = collectWritingClaims(edits, [], [], sources)
  expect(claims[0]).toMatchObject({ kind: 'citation', quote: 'known', references: [{ path: 'refs.bib', line: 1, kind: 'bibliography' }] })
  expect(claims[1]).toMatchObject({ kind: 'citation', quote: 'missing', references: [] })
  expect(collectWritingClaims(edits, [], [], [...sources, { ...sources[0], path: 'other.bib' }])[0].references).toEqual([])
})
