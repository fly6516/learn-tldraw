

export type ResearchNodeType =
    | 'title'
    | 'abstract'
    | 'introduction'
    | 'related-work'
    | 'method'
    | 'experiment'
    | 'result'
    | 'discussion'
    | 'conclusion'
    | 'reference'



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
    introduction: {
        label: 'Introduction',
        order: 2,
        multiple: true,
        description: 'Research background and motivation',
    },
    'related-work': {
        label: 'Related Work',
        order: 3,
        multiple: true,
        description: 'Summary of prior research',
    },
    method: {
        label: 'Method',
        order: 4,
        multiple: true,
        description: 'Methodology and approach',
    },
    experiment: {
        label: 'Experiment',
        order: 5,
        multiple: true,
        description: 'Experimental setup',
    },
    result: {
        label: 'Results',
        order: 6,
        multiple: true,
        description: 'Results and findings',
    },
    discussion: {
        label: 'Discussion',
        order: 7,
        multiple: true,
        description: 'Interpretation of results',
    },
    conclusion: {
        label: 'Conclusion',
        order: 8,
        multiple: false,
        description: 'Final conclusions',
    },
    reference: {
        label: 'References',
        order: 9,
        multiple: false,
        description: 'Bibliography',
    },
}
