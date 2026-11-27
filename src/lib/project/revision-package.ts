import JSZip from 'jszip'
import { buildRevisionLetter, compareRevisionFiles, readRevisionBaseline, type RevisionRound } from './revision-rounds'
import type { SubmissionVersionInfo } from './submission'
import { compareRevisionChanges } from './revision-evidence'

export type RevisionPackageInput = {
  round: RevisionRound
  original: SubmissionVersionInfo & { zip: Blob }
  revised: SubmissionVersionInfo & { zip: Blob; pdf: Blob }
}

async function checksum(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function identify(archive: RevisionPackageInput['original']) {
  const source = await archive.zip.arrayBuffer()
  const sourceChecksum = await checksum(source)
  if (archive.sourceChecksum && sourceChecksum !== archive.sourceChecksum) {
    throw new Error(`The archived source ZIP for ${archive.name} failed its checksum.`)
  }
  return { source, version: { id: archive.id, name: archive.name, createdAt: archive.createdAt, main: archive.main,
    sourceChecksum, compileProfile: archive.compileProfile, externalEngine: archive.externalEngine } }
}

export async function buildRevisionPackage({ round, original, revised }: RevisionPackageInput) {
  if (round.submissionId !== original.id || round.revisedSubmissionId !== revised.id || original.id === revised.id) {
    throw new Error('Choose the archived original and revised versions for this round.')
  }
  if (!round.comments.length) throw new Error('Add at least one reviewer comment to this round.')
  if (await revised.pdf.slice(0, 5).text() !== '%PDF-') throw new Error('The revised archive does not contain a valid PDF.')
  const [baseline, current, before, after] = await Promise.all([
    identify(original), identify(revised), readRevisionBaseline(original.zip), readRevisionBaseline(revised.zip),
  ])
  const compared = await compareRevisionFiles(before, after)
  const binding = { originalId: original.id, revisedId: revised.id,
    originalSha256: baseline.version.sourceChecksum, revisedSha256: current.version.sourceChecksum }
  const letter = buildRevisionLetter(round, original.name, revised.name, compared, binding, await compareRevisionChanges(compared))
  if (letter.unresolved.length) throw new Error('Resolve all reviewer responses and verify their evidence before exporting the revision package.')

  const manuscript = await revised.pdf.arrayBuffer()
  const response = new TextEncoder().encode(letter.markdown)
  const files = [
    { name: 'manuscript.pdf', data: manuscript },
    { name: 'source.zip', data: current.source },
    { name: 'response.md', data: response },
  ] as const
  const manifest = {
    format: 'research-canvas-revision', version: 1,
    round: { id: round.id, name: round.name, comments: round.comments.length },
    original: baseline.version, revised: current.version,
    files: await Promise.all(files.map(async ({ name, data }) => ({
      name, bytes: data.byteLength, sha256: name === 'source.zip' ? current.version.sourceChecksum
        : await checksum(data instanceof Uint8Array ? data.buffer : data),
    }))),
  }
  const archive = new JSZip()
  const date = new Date('1980-01-01T00:00:00Z')
  for (const { name, data } of files) archive.file(name, data, { date })
  archive.file('manifest.json', JSON.stringify(manifest, null, 2), { date })
  return archive.generateAsync({ type: 'blob', compression: 'STORE' })
}
