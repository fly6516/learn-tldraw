/**
 * LaTeX Template Presets
 * Predefined templates for different document types
 */

import { TemplatePreset, TemplatePresetType } from './types'

/**
 * Chinese GB/T 7714 Template
 */
const chineseGBTemplate: TemplatePreset = {
  id: 'chinese-gb',
  name: '中文 GB/T 7714',
  description: '中文学术论文模板，符合 GB/T 7714 标准',
  language: 'zh',
  documentClass: 'ctexart',
  documentClassOptions: ['UTF8', 'a4paper', '12pt'],
  packages: [
    'geometry',
    'graphicx',
    'amsmath',
    'amssymb',
    'cite',
    'hyperref',
    'gbt7714',
  ],
  preambleTemplate: `\\documentclass[UTF8,a4paper,12pt]{ctexart}

% 页面设置
\\usepackage[top=2.54cm, bottom=2.54cm, left=3.18cm, right=3.18cm]{geometry}

% 图片支持
\\usepackage{graphicx}
\\graphicspath{{figures/}}

% 数学公式
\\usepackage{amsmath}
\\usepackage{amssymb}

% 参考文献
\\usepackage{cite}
\\usepackage{gbt7714}
\\bibliographystyle{gbt7714-numerical}

% 超链接
\\usepackage{hyperref}
\\hypersetup{
    colorlinks=true,
    linkcolor=black,
    citecolor=blue,
    urlcolor=blue
}

% 自定义命令
% \\newcommand{\\mycommand}{...}
`,
  sectionNames: {
    introduction: '引言',
    'related-work': '相关工作',
    method: '方法',
    experiment: '实验',
    result: '结果',
    discussion: '讨论',
    conclusion: '结论',
    acknowledgments: '致谢',
    reference: '参考文献',
    appendix: '附录',
  },
}

/**
 * English Article Template
 */
const englishArticleTemplate: TemplatePreset = {
  id: 'english-article',
  name: 'English Article',
  description: 'Standard English academic article template',
  language: 'en',
  documentClass: 'article',
  documentClassOptions: ['12pt', 'a4paper'],
  packages: [
    'geometry',
    'graphicx',
    'amsmath',
    'amssymb',
    'cite',
    'hyperref',
  ],
  preambleTemplate: `\\documentclass[12pt,a4paper]{article}

% Page layout
\\usepackage[top=1in, bottom=1in, left=1in, right=1in]{geometry}

% Graphics
\\usepackage{graphicx}
\\graphicspath{{figures/}}

% Mathematics
\\usepackage{amsmath}
\\usepackage{amssymb}

% Citations
\\usepackage{cite}

% Hyperlinks
\\usepackage{hyperref}
\\hypersetup{
    colorlinks=true,
    linkcolor=black,
    citecolor=blue,
    urlcolor=blue
}

% Custom commands
% \\newcommand{\\mycommand}{...}
`,
  sectionNames: {
    introduction: 'Introduction',
    'related-work': 'Related Work',
    method: 'Method',
    experiment: 'Experiment',
    result: 'Results',
    discussion: 'Discussion',
    conclusion: 'Conclusion',
    acknowledgments: 'Acknowledgments',
    reference: 'References',
    appendix: 'Appendix',
  },
}

/**
 * IEEE Template
 */
const ieeeTemplate: TemplatePreset = {
  id: 'ieee',
  name: 'IEEE Conference',
  description: 'IEEE conference paper template',
  language: 'en',
  documentClass: 'IEEEtran',
  documentClassOptions: ['conference'],
  packages: [
    'graphicx',
    'amsmath',
    'amssymb',
    'cite',
    'hyperref',
  ],
  preambleTemplate: `\\documentclass[conference]{IEEEtran}

% Graphics
\\usepackage{graphicx}
\\graphicspath{{figures/}}

% Mathematics
\\usepackage{amsmath}
\\usepackage{amssymb}

% Citations
\\usepackage{cite}

% Hyperlinks
\\usepackage{hyperref}
\\hypersetup{
    colorlinks=true,
    linkcolor=black,
    citecolor=blue,
    urlcolor=blue
}

% Custom commands
% \\newcommand{\\mycommand}{...}
`,
  sectionNames: {
    introduction: 'Introduction',
    'related-work': 'Related Work',
    method: 'Methodology',
    experiment: 'Experiments',
    result: 'Results',
    discussion: 'Discussion',
    conclusion: 'Conclusion',
    acknowledgments: 'Acknowledgments',
    reference: 'References',
    appendix: 'Appendix',
  },
}

/**
 * ACM Template
 */
const acmTemplate: TemplatePreset = {
  id: 'acm',
  name: 'ACM Conference',
  description: 'ACM conference paper template',
  language: 'en',
  documentClass: 'acmart',
  documentClassOptions: ['sigconf'],
  packages: [
    'graphicx',
    'amsmath',
    'amssymb',
    'hyperref',
  ],
  preambleTemplate: `\\documentclass[sigconf]{acmart}

% Graphics
\\usepackage{graphicx}
\\graphicspath{{figures/}}

% Mathematics
\\usepackage{amsmath}
\\usepackage{amssymb}

% Hyperlinks
\\usepackage{hyperref}
\\hypersetup{
    colorlinks=true,
    linkcolor=black,
    citecolor=blue,
    urlcolor=blue
}

% ACM metadata
\\acmConference[Conference]{Conference Name}{Year}{Location}

% Custom commands
% \\newcommand{\\mycommand}{...}
`,
  sectionNames: {
    introduction: 'Introduction',
    'related-work': 'Related Work',
    method: 'Approach',
    experiment: 'Evaluation',
    result: 'Results',
    discussion: 'Discussion',
    conclusion: 'Conclusion',
    acknowledgments: 'Acknowledgments',
    reference: 'References',
    appendix: 'Appendix',
  },
}

/**
 * Springer LNCS Template
 */
const springerTemplate: TemplatePreset = {
  id: 'springer',
  name: 'Springer LNCS',
  description: 'Springer Lecture Notes in Computer Science template',
  language: 'en',
  documentClass: 'llncs',
  documentClassOptions: [],
  packages: [
    'graphicx',
    'amsmath',
    'amssymb',
    'cite',
    'hyperref',
  ],
  preambleTemplate: `\\documentclass{llncs}

% Graphics
\\usepackage{graphicx}
\\graphicspath{{figures/}}

% Mathematics
\\usepackage{amsmath}
\\usepackage{amssymb}

% Citations
\\usepackage{cite}

% Hyperlinks
\\usepackage{hyperref}
\\hypersetup{
    colorlinks=true,
    linkcolor=black,
    citecolor=blue,
    urlcolor=blue
}

% Custom commands
% \\newcommand{\\mycommand}{...}
`,
  sectionNames: {
    introduction: 'Introduction',
    'related-work': 'Related Work',
    method: 'Method',
    experiment: 'Experiments',
    result: 'Results',
    discussion: 'Discussion',
    conclusion: 'Conclusion',
    acknowledgments: 'Acknowledgments',
    reference: 'References',
    appendix: 'Appendix',
  },
}

/**
 * All available templates
 */
export const TEMPLATE_PRESETS: Record<TemplatePresetType, TemplatePreset> = {
  'chinese-gb': chineseGBTemplate,
  'english-article': englishArticleTemplate,
  'ieee': ieeeTemplate,
  'acm': acmTemplate,
  'springer': springerTemplate,
  'custom': {
    id: 'custom',
    name: 'Custom Template',
    description: 'User-defined custom template',
    language: 'en',
    documentClass: 'article',
    documentClassOptions: [],
    packages: [],
    preambleTemplate: '',
    sectionNames: {
      introduction: 'Introduction',
      'related-work': 'Related Work',
      method: 'Method',
      experiment: 'Experiment',
      result: 'Results',
      discussion: 'Discussion',
      conclusion: 'Conclusion',
      acknowledgments: 'Acknowledgments',
      reference: 'References',
      appendix: 'Appendix',
    },
  },
}

/**
 * Get template by ID
 */
export function getTemplate(id: TemplatePresetType): TemplatePreset {
  return TEMPLATE_PRESETS[id]
}

/**
 * Get all template IDs
 */
export function getTemplateIds(): TemplatePresetType[] {
  return Object.keys(TEMPLATE_PRESETS) as TemplatePresetType[]
}

/**
 * Get templates by language
 */
export function getTemplatesByLanguage(language: 'en' | 'zh'): TemplatePreset[] {
  return Object.values(TEMPLATE_PRESETS).filter(t => t.language === language)
}
