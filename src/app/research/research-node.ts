

export type ResearchNodeType =
    | 'title'
    | 'abstract'
    | 'keywords'
    | 'introduction'
    | 'related-work'
    | 'method'
    | 'experiment'
    | 'result'
    | 'discussion'
    | 'conclusion'
    | 'limitations'
    | 'future-work'
    | 'acknowledgments'
    | 'reference'
    | 'appendix'
    | 'custom'



export const RESEARCH_NODE_META: Record<
    ResearchNodeType,
    {
        label: string
        order: number
        multiple: boolean
        description: string
    }
> = {
    title: {
        label: 'Title',
        order: 0,
        multiple: false,
        description: 'The title of the paper',
    },
    abstract: {
        label: 'Abstract',
        order: 1,
        multiple: false,
        description: 'Brief summary of the research',
    },
    keywords: {
        label: 'Keywords',
        order: 2,
        multiple: false,
        description: 'Key terms and concepts',
    },
    introduction: {
        label: 'Introduction',
        order: 3,
        multiple: true,
        description: 'Research background and motivation',
    },
    'related-work': {
        label: 'Related Work',
        order: 4,
        multiple: true,
        description: 'Summary of prior research',
    },
    method: {
        label: 'Method',
        order: 5,
        multiple: true,
        description: 'Methodology and approach',
    },
    experiment: {
        label: 'Experiment',
        order: 6,
        multiple: true,
        description: 'Experimental setup',
    },
    result: {
        label: 'Results',
        order: 7,
        multiple: true,
        description: 'Results and findings',
    },
    discussion: {
        label: 'Discussion',
        order: 8,
        multiple: true,
        description: 'Interpretation of results',
    },
    conclusion: {
        label: 'Conclusion',
        order: 9,
        multiple: false,
        description: 'Final conclusions',
    },
    limitations: {
        label: 'Limitations',
        order: 10,
        multiple: true,
        description: 'Study limitations and constraints',
    },
    'future-work': {
        label: 'Future Work',
        order: 11,
        multiple: true,
        description: 'Directions for future research',
    },
    acknowledgments: {
        label: 'Acknowledgments',
        order: 12,
        multiple: false,
        description: 'Credits and thanks',
    },
    reference: {
        label: 'References',
        order: 13,
        multiple: false,
        description: 'Bibliography',
    },
    appendix: {
        label: 'Appendix',
        order: 14,
        multiple: true,
        description: 'Supplementary materials',
    },
    custom: {
        label: 'Custom Section',
        order: 99,
        multiple: true,
        description: 'User-defined section',
    },
}
