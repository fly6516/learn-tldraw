'use client'

import { ResearchWorkspace } from '@/components/research/ResearchWorkspace'
import { createTestPaper, testScenarios } from '@/lib/project/test-paper'

export function TestWorkspace() {
  return <ResearchWorkspace initialProject={createTestPaper} storageNamespace="research-release-test-v1" notice={
    <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 border-b bg-indigo-50 px-3 py-1.5 text-xs text-slate-900">
      <strong>Local test workspace · simulated AI</strong>
      <span>Open Writing AI, select both chapter files in Scope, then send <code>{testScenarios.pass}</code>, <code>{testScenarios.fail}</code>, or <code>{testScenarios.interrupted}</code>.</span>
      <a className="font-medium text-indigo-700 underline" href="/api/latex/test-fixture" download>Download test project ZIP</a>
    </div>
  } />
}
