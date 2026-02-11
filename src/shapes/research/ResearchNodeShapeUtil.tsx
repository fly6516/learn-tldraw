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
        level: T.number,
        parentId: T.optional(T.string),
        customLabel: T.optional(T.string),
        tags: T.optional(T.arrayOf(T.string)),
        metadata: T.optional(
            T.object({
                originalTitle: T.optional(T.string),
                sectionNumber: T.optional(T.string),
                imported: T.optional(T.boolean),
                importSource: T.optional(T.string),
                createdAt: T.optional(T.string),
                updatedAt: T.optional(T.string),
            })
        ),
    }

    getDefaultProps(): ResearchNodeShape['props'] {
        return {
            section: 'introduction',
            content: '',
            order: 0,
            level: 1,
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
        const level = shape.props.level || 1
        const hasParent = !!shape.props.parentId
        const hasTags = shape.props.tags && shape.props.tags.length > 0

        return (
            <HTMLContainer
                style={{
                    pointerEvents: 'all',
                    background: '#ffffff',
                    borderRadius: 8,
                    border: hasParent ? '2px solid #3b82f6' : '1px solid #ddd',
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
                        background: hasParent ? '#eff6ff' : '#f5f5f5',
                        borderBottom: '1px solid #eee',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* Level indicator */}
                        {level > 1 && (
                            <span style={{ fontSize: 10, color: '#666' }}>
                                {'└'.repeat(level - 1)}
                            </span>
                        )}
                        <span>{displayLabel}</span>
                        {shape.props.metadata?.sectionNumber && (
                            <span style={{ fontSize: 10, color: '#888' }}>
                                ({shape.props.metadata.sectionNumber})
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {shape.props.metadata?.imported && (
                            <span style={{ fontSize: 10, color: '#888', background: '#e0e7ff', padding: '2px 4px', borderRadius: 3 }}>
                                imported
                            </span>
                        )}
                        {hasParent && (
                            <span style={{ fontSize: 10, color: '#3b82f6', background: '#dbeafe', padding: '2px 4px', borderRadius: 3 }}>
                                sub
                            </span>
                        )}
                    </div>
                </div>

                {/* Tags */}
                {hasTags && (
                    <div
                        style={{
                            padding: '4px 10px',
                            fontSize: 10,
                            background: '#fafafa',
                            borderBottom: '1px solid #eee',
                            display: 'flex',
                            gap: 4,
                            flexWrap: 'wrap',
                        }}
                    >
                        {shape.props.tags!.map((tag, idx) => (
                            <span
                                key={idx}
                                style={{
                                    background: '#e5e7eb',
                                    color: '#374151',
                                    padding: '2px 6px',
                                    borderRadius: 3,
                                }}
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                )}

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
                                metadata: {
                                    ...shape.props.metadata,
                                    updatedAt: new Date().toISOString(),
                                },
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