'use client'

import { useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ReactNode } from 'react'

const widePanel = '(min-width: 1280px)'

function subscribe(change: () => void) {
  const media = window.matchMedia(widePanel)
  media.addEventListener('change', change)
  return () => media.removeEventListener('change', change)
}

export function useRightToolPanelWide() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(widePanel).matches, () => false)
}

export function RightToolPanel({ id, title, open, expanded, onResize, onClose, icon, children }: {
  id: string; title: string; open: boolean; expanded: boolean
  onResize: () => void; onClose: () => void; icon?: ReactNode; children: ReactNode
}) {
  return <aside id={id} aria-label={title} hidden={!open}
    className={`absolute inset-y-0 right-0 z-20 flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l bg-background shadow-lg xl:relative xl:z-auto xl:shadow-none
      ${expanded ? 'w-full sm:w-[min(100%,36rem)] xl:w-[clamp(28rem,33vw,36rem)]' : 'w-[min(90%,24rem)] xl:w-[clamp(19rem,24vw,26rem)]'}`}
    style={open ? undefined : { display: 'none' }}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.stopPropagation()
        onClose()
      }
    }}>
    <div className="flex shrink-0 items-center justify-between gap-1 border-b px-2 py-1">
      <h2 className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold">{icon}{title}</h2>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={onResize}>{expanded ? 'Reduce' : 'Expand'}</Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Close ${title}`} onClick={onClose}><X /></Button>
      </div>
    </div>
    {children}
  </aside>
}
