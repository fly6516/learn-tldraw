import * as React from 'react'
import {
    HTMLContainer,
    Rectangle2d,
    ShapeUtil,
    TLResizeInfo,
    T,
} from 'tldraw'

import type { ResearchNodeShape } from './ResearchNodeShape'
import { RESEARCH_NODE_META } from '@/app/research/research-node'
import { ResearchNodeSectionStyle } from './ResearchNodeStyles'

export class ResearchNodeShapeUtil extends ShapeUtil<ResearchNodeShape> {
    static type = 'research-node' as const
    static styles = [ResearchNodeSectionStyle]

    static props = {
        section: T.literalEnum(
            'title',
            'abstract',
            'keywords',
            'introduction',
            'related-work',
            'method',
            'experiment',
            'result',
            'discussion',
            'conclusion',
            'limitations',
            'future-work',
            'acknowledgments',
            'reference',
            'appendix',
            'custom'
        ),
        content: T.string,
        order: T.number,
        customLabel: T.optional(T.string),
        metadata: T.optional(
            T.object({
                originalTitle: T.optional(T.string),
                sectionNumber: T.optional(T.string),
                imported: T.optional(T.boolean),
                importSource: T.optional(T.string),
            })
        ),
    }

    getDefaultProps(): ResearchNodeShape['props'] {
        return {
            section: 'introduction',
            content: '',
            order: 0,
        }
    }

    getGeometry(shape: ResearchNodeShape) {
        return new Rectangle2d({
            width: 420,
            height: 240,
            isFilled: true,
        })
    }

    component(shape: ResearchNodeShape) {
        const meta = RESEARCH_NODE_META[shape.props.section]
        const displayLabel = shape.props.customLabel || meta.label

        return (
            <HTMLContainer
                style={{
                    pointerEvents: 'all',
                    background: '#ffffff',
                    borderRadius: 8,
                    border: '1px solid #ddd',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Section header */}
                <div
                    style={{
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        background: '#f5f5f5',
                        borderBottom: '1px solid #eee',
                    }}
                >
                    {displayLabel}
                    {shape.props.metadata?.imported && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: '#888' }}>
                            (imported)
                        </span>
                    )}
                </div>

                {/* Editable content */}
                <textarea
                    value={shape.props.content}
                    placeholder={`Write ${displayLabel} here...`}
                    onChange={(e) => {
                        this.editor.updateShape<ResearchNodeShape>({
                            id: shape.id,
                            type: shape.type,
                            props: {
                                ...shape.props,
                                content: e.target.value,
                            },
                        })
                    }}
                    style={{
                        flex: 1,
                        resize: 'none',
                        border: 'none',
                        outline: 'none',
                        padding: 10,
                        fontSize: 14,
                        lineHeight: 1.5,
                        fontFamily: 'inherit',
                    }}
                />
            </HTMLContainer>
        )
    }

    indicator(shape: ResearchNodeShape) {
        return <rect width={420} height={240} />
    }

    onResize(shape: ResearchNodeShape, info: TLResizeInfo<ResearchNodeShape>) {
        return shape
    }
}