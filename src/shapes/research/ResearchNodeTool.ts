import { StateNode, createShapeId, TLPointerEventInfo } from 'tldraw'
import type { ResearchNodeType } from '@/app/research/research-node'

export class ResearchNodeTool extends StateNode {
    static id = 'research-node'

    override onEnter() {
        this.editor.setCursor({ type: 'cross', rotation: 0 })
    }

    override onPointerDown(info: TLPointerEventInfo) {
        const { x, y } = info.point

        const section: ResearchNodeType = 'introduction'

        this.editor.createShape({
            id: createShapeId(),
            type: 'research-node',
            x,
            y,
            props: {
                section,
                content: '',
                order: 0,
            },
        } as never)
    }
}