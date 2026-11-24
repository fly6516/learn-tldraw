import type { AiContextReceipt } from './ai-read-scope'

export function aiContextApprovalKey(receipt: AiContextReceipt, purpose: string, diagnostics: unknown, extra?: unknown) {
  const files = receipt.files.map(({ path, kind, partial, lines, page }) => [path, kind, Boolean(partial), lines, page] as const)
    .sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1])
      || (left[3]?.start ?? 0) - (right[3]?.start ?? 0))
  return JSON.stringify([purpose, files, receipt.restricted, receipt.taskNotes, Boolean(receipt.reviewerComment), diagnostics, extra])
}
