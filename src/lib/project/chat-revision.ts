import { archiveReplyEvidence } from './ai-revision'
import { indexLatexLabels } from './latex-source'
import { buildRevisionLetter, compareRevisionFiles, readRevisionBaseline } from './revision-rounds'
import { addRevisionComment, createRevisionRound, listRevisionRounds, listSubmissionVersions, readSubmissionFiles } from './storage'
import { revisionSetupSchema, type ReplyChatRequest, type ChatReplyTarget, type ChatRevisionSetup } from './writing-chat'
import type { WritingKey } from './writing-drafts'

async function revisionArchives(database: IDBDatabase, key: WritingKey, roundName?: string, revisedName?: string) {
  const [rounds, versions] = await Promise.all([listRevisionRounds(database, key), listSubmissionVersions(database, key)])
  const candidates = roundName ? rounds.filter(round => round.name === roundName) : rounds
  if (candidates.length !== 1) throw new Error(candidates.length
    ? 'Several revision rounds match. Specify the exact name of a unique round.'
    : 'No matching revision round. Create a round or check its name.')
  const round = candidates[0]
  const original = versions.find(item => item.id === round.submissionId)
  const choices = versions.filter(item => item.id !== round.submissionId && (!original || item.createdAt >= original.createdAt)
    && (revisedName ? item.name === revisedName : item.id === round.revisedSubmissionId))
  if (choices.length !== 1 || !original) throw new Error('A unique revised archive and the original submission are required. Link the revised archive or specify its exact name.')
  const revised = choices[0]
  if (round.revisedSubmissionId && round.revisedSubmissionId !== revised.id) {
    throw new Error('This round already uses a different revised archive. Change it in Revision rounds before drafting a reply.')
  }
  const [a, b] = await Promise.all([readSubmissionFiles(database, key, original.id), readSubmissionFiles(database, key, revised.id)])
  if (!a || !b) throw new Error('The archived source ZIPs are unavailable.')
  const [first, second] = await Promise.all([readRevisionBaseline(a.zip), readRevisionBaseline(b.zip)])
  return { round, original, revised, project: second, files: await compareRevisionFiles(first, second) }
}

export async function prepareChatReply(database: IDBDatabase, key: WritingKey, request: ReplyChatRequest, excluded = (_path: string) => false) {
  const { round, original, revised, project, files } = await revisionArchives(database, key, request.round, request.revised)
  const comment = round.comments[request.comment - 1]
  if (!comment) throw new Error('No reviewer comment has that number in this round.')
  let target: string | undefined
  if (comment.kind === 'comment') {
    if ('path' in comment.target) target = comment.target.path
    else if ('path' in comment.target.anchor) target = comment.target.anchor.path
    else {
      const labels = indexLatexLabels([...project.files.values()].flatMap(file =>
        'content' in file && file.content && /\.tex$/i.test(file.path) ? [[file.path, file.content] as const] : []))
      const locations = labels.get(comment.target.anchor.label)
      if (locations?.length === 1) target = locations[0].path
      else if (!comment.response?.paths.length) throw new Error('This comment’s source label is missing or ambiguous in the revised ZIP.')
    }
  }
  const intendedPaths = new Set([...(comment.response?.paths ?? []), ...(target ? [target] : [])])
  if ([...intendedPaths].some(excluded)) throw new Error('The selected reviewer comment uses a project path excluded from AI reading.')
  const paths = files.filter(file => file.status !== 'Unchanged' && /\.(tex|bib|cls|sty)$/i.test(file.path)
    && !excluded(file.path) && (!intendedPaths.size || intendedPaths.has(file.path))).map(file => file.path)
  if (paths.length > 6) throw new Error('The comment matches more than six changed source files. Narrow the evidence in Revision rounds.')
  const changes = await archiveReplyEvidence(files, paths)
  const authorNote = request.authorNote ?? (comment.response?.kind === 'retained' ? comment.response.text.slice(0, 1500) : '')
  if (!changes.length && !authorNote) throw new Error('No changed source matches this comment. Provide an author rationale if the text was retained.')
  const kind = changes.length ? 'changed' as const : 'retained' as const
  const reply: ChatReplyTarget = { round: round.id, roundName: round.name, comment: comment.id, commentText: comment.text,
    originalId: original.id, revisedId: revised.id, previousRevisedId: round.revisedSubmissionId, previous: comment.response,
    paths, kind }
  return { reply, revision: { comment: comment.text, original: original.name, revised: revised.name, changes, kind, authorNote } }
}

export async function prepareChatLetter(database: IDBDatabase, key: WritingKey, roundName?: string) {
  const { round, original, revised, files } = await revisionArchives(database, key, roundName)
  if (!round.comments.length) throw new Error('This revision round has no reviewer comments.')
  return { name: round.name, ...buildRevisionLetter(round, original.name, revised.name, files) }
}

export async function prepareChatRevisionSetup(database: IDBDatabase, key: WritingKey, action: 'newround' | 'comment', args: string[]) {
  if (action === 'newround') {
    const [name, baseline] = args
    if (!name || !baseline || args.length !== 2) throw new Error('Use /newround <round name> | <archived submission name>.')
    const versions = (await listSubmissionVersions(database, key)).filter(version => version.name === baseline)
    if (versions.length !== 1) throw new Error('Choose the exact name of a unique archived submission.')
    return revisionSetupSchema.parse({ kind: 'round', name, baseline, baselineId: versions[0].id })
  }
  const [path, text, roundName] = args
  if (!path || !text || args.length > 3) throw new Error('Use /comment <source path> | <comment text> | <round name>.')
  const rounds = (await listRevisionRounds(database, key)).filter(round => !roundName || round.name === roundName)
  if (rounds.length !== 1) throw new Error('Choose the exact name of a unique revision round.')
  return revisionSetupSchema.parse({ kind: 'comment', round: rounds[0].id, roundName: rounds[0].name, text, path })
}

export async function confirmChatRevisionSetup(database: IDBDatabase, key: WritingKey, id: string, setup: ChatRevisionSetup) {
  if (setup.kind === 'round') {
    await createRevisionRound(database, key, { id, name: setup.name, submissionId: setup.baselineId,
      createdAt: new Date().toISOString(), comments: [] }, id)
  } else {
    await addRevisionComment(database, key, setup.round, { id, kind: 'comment', reviewer: '', text: setup.text,
      target: { type: 'file', path: setup.path } }, id)
  }
}
