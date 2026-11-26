import type { decodeProjectBackup } from '@/lib/project/backup'

export function BackupContents({ backup }: { backup: Awaited<ReturnType<typeof decodeProjectBackup>> }) {
  const { canvas, project, writing, history, conflicts } = backup
  const attachments = [...project.files.values()].filter(entry => entry.type !== 'directory' && entry.blob).length
  return <div className="space-y-1 text-sm">
    <p>Validated <strong>{project.metadata.projectName}</strong>.</p>
    <ul className="list-inside list-disc">
      <li>{canvas.pages.length} Canvas pages, {attachments} attachments</li>
      <li>{Object.keys(writing?.drafts ?? {}).length} local drafts</li>
      <li>{history?.publication ? `${history.publication.submissions.length} submission versions, ${history.publication.rounds.length} revision rounds` : 'Submission and revision history not included'}</li>
      {history?.publication?.docx?.length ? <li>{history.publication.docx.length} archived DOCX deliveries</li> : null}
      {history?.templateReleases?.map(release => <li key={`${release.id}-${release.version}-${release.manifestSha256}`}>
        Official template {release.id} · {release.version} · {release.attachments?.length} verified attachments
        {release.wordAcceptance && ` · Microsoft Word ${release.wordAcceptance.version} verified`}
      </li>)}
      <li>{history?.snapshots ? `${history.snapshots.length} project snapshots` : 'Snapshots not included'}</li>
      <li>{history?.ai ? `${history.ai.history?.conversations.length ?? 0} AI conversations with task history` : 'AI history not included'}</li>
      {!!Object.keys(history?.ai?.builds ?? {}).length && <li>{Object.keys(history?.ai?.builds ?? {}).length} verified manuscript PDFs</li>}
    </ul>
    {conflicts.length > 0 && <p className="text-amber-800">{conflicts.length} local drafts differ from their saved baseline. Compare in Writing after restoring.</p>}
  </div>
}
