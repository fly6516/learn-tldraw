import { builtInPaperTemplates, openTemplateArchive, springerTemplate, templateDigest, type PaperTemplate } from './paper-templates'
import { suepUndergraduateSource } from './suep-undergraduate-source'
import type { TemplateOrigin } from './template-release'
import { wordLayoutCompile, type CompileProfile } from './compile-profile'
import type { WordProfile } from './word-import'
import type { ProjectFileSystem } from './types'

type OfficialFile = { url: string; sha256: string }
type TemplateCompile = { mainFile: string; compileProfile: CompileProfile }

type LayoutChecks = { kind: 'prl' | 'mnras' | 'elsevier-cas' | 'agu-journal' | 'manual' } | {
  kind: 'latex-class'; documentClass: string; options: readonly string[]; package: string;
  label: string; manualLabel: string; manualDetail: string; evidence: string;
}

type OfficialTemplateWorkflow = { version: string; original: OfficialFile; compile: TemplateCompile } & (
  | { kind: 'word'; guideline?: OfficialFile; declaration?: OfficialFile; blindCover?: OfficialFile; njuptTrack?: 'academic' | 'professional'; updateLink?: string; checks: { kind: 'word-layout' | 'sjtu-word' } }
  | { kind: 'zip'; upstream?: OfficialFile & { mainFile: string }; checks: LayoutChecks;
      prepare?: 'revtex' | 'mit-thesis' | 'agu-journal'; entryFiles?: readonly string[]; preview?: 'external'; redirectHosts?: readonly string[] }
)
type WordImportWorkflow = {
  kind: 'word-import'; profile: WordProfile; compile: TemplateCompile; version: string; original: OfficialFile;
  checks: { kind: 'suep' }
}
type ReferenceWorkflow = { kind: 'reference' }

export type TemplateCategory = 'general' | 'school' | 'journal'
export type CatalogTemplate = {
  id: string
  name: string
  category: TemplateCategory
  language: string
  summary: string
  sections: readonly string[]
  keywords?: readonly string[]
  layout: 'article' | 'columns' | 'thesis'
  sourceUrl?: string
  requirementsUrl?: string
  downloadUrl?: string
  previewUrl?: string
  previewLabel?: string
  requirementsLabel?: string
  sourceVersion?: string
  verification?: string
  manualReview?: string
  community?: boolean
  exportProfile?: 'publisher-article' | 'zju-undergraduate' | 'jmlr-article' | 'suep-undergraduate' | 'prl-article' | 'sjtu-graduate-word' | 'njupt-masters' | 'official-thesis' | 'thuthesis' | 'starter-article' | 'mit-thesis'
} & (
  | { delivery: 'built-in'; template: (typeof builtInPaperTemplates)[number]; workflow: { kind: 'starter'; sha256: string; compile: TemplateCompile; checks: { kind: 'manual' } } }
  | { delivery: 'archive'; template: PaperTemplate & { sha256: string }; workflow: Extract<OfficialTemplateWorkflow, { kind: 'zip' }> }
  | { delivery: 'official'; officialFiles: readonly { label: string; url: string }[];
      workflow: Extract<OfficialTemplateWorkflow, { kind: 'word' }> | WordImportWorkflow | ReferenceWorkflow }
  | { delivery: 'reference'; workflow: ReferenceWorkflow }
)

export type LocalPaperTemplate = Pick<PaperTemplate, 'id' | 'name' | 'version' | 'mainFile' | 'compileProfile'> & {
  archive: Blob
  sha256: string
  kind?: 'word-layout'
  reference?: boolean
  origin?: TemplateOrigin
}

const starterCheckSums = {
  'english-article': '62fd7b00ef9b10c74c2df1cfba61d15524e4086ca6e3e903f7cfbfeee0b920f3',
  'chinese-article': 'c99aca43c865e40360416cd0cc90844b0f78b0063dd9e7e201419fbf868616f7',
}
const builtInCatalog: CatalogTemplate[] = builtInPaperTemplates.map(template => ({
  ...template, category: 'general', layout: 'article', delivery: 'built-in', exportProfile: 'starter-article', template,
  workflow: { kind: 'starter', sha256: starterCheckSums[template.id], compile: template, checks: { kind: 'manual' } },
  previewUrl: '/template-previews/' + template.id + '.png',
  summary: 'A general-purpose research article with separate section files and an example bibliography.',
}))

const suepKeywords = ['SUEP', 'Shanghai University of Electric Power', '上电']
const apsRoot = 'revtex-tds/'
const apsTemplate = apsRoot + 'doc/latex/revtex/sample/aps/apstemplate.tex'
const njuptPage = 'https://pg.njupt.edu.cn/2025/0530/c978a284783/page.htm'
const njuptGuide = 'https://pg.njupt.edu.cn/2009/1119/c14020a14690/page.htm'
const njuptFiles = 'https://pg.njupt.edu.cn/_upload/article/files/ee/24/7d0bd75140f1ab28894791372b6c/'
export const njuptBlindCover = {
  url: 'https://pg.njupt.edu.cn/_upload/article/files/bd/78/f4b43f084e7689f6d504a5fd8ce8/64394426-6fd3-4655-9b5b-16b8008d4177.doc',
  sha256: '7c393e5b666cb99660f5db7b34fbc43dd7a1290fd763c210a109e4c8e379b64b',
  page: 'https://pg.njupt.edu.cn/2012/0223/c979a17984/page.htm',
} as const
const njuptDeclaration = { url: njuptFiles + '44f4a937-34f0-44e6-9642-092b23320dec.doc',
  sha256: '844a60ff1301a2e7bf6f8ce5c492037899e2962fa67d2b92d6736e3196294c17' }
const zjuFiles = 'https://bms.zju.edu.cn/_upload/article/files/8b/05/6f97db8e4843a9fdf8f2913002f6/'
const jmlrCommit = 'f413f638b407af76074813f8f88a82a7a5a81e9d'
const zjuWorkflow = {
  kind: 'word', version: '2026-09-01',
  original: { url: zjuFiles + '07794228-a1b3-4356-bc98-950306b07c2c.docx',
    sha256: '8dcf654f05be9d504ee98f6700101028aebd0cc990cea7aff26fb05d6317f512' },
  guideline: { url: zjuFiles + '587de67d-7c81-4475-8e8d-db0a82130801.pdf',
    sha256: '11825591e22311b0d1ca65b9c1ebcb47a58c8f891a1e98942223bbd82040954d' },
  updateLink: '附件6[：:]基础医学院本科生毕业论文-毕业论文模板',
  compile: wordLayoutCompile, checks: { kind: 'word-layout' },
} as const satisfies OfficialTemplateWorkflow

const jmlrWorkflow = {
  kind: 'zip', version: jmlrCommit.slice(0, 7),
  original: { url: 'https://codeload.github.com/JmlrOrg/jmlr-style-file/zip/' + jmlrCommit,
    sha256: '175549d8d9c44a29bfb3d4a3b2c71386d30b3ca1a1490fa41958d0ae2de9ba9c' },
  upstream: { url: 'https://codeload.github.com/JmlrOrg/jmlr-style-file/zip/refs/heads/master',
    sha256: 'ae98919e069a0a5557932e471acf462f2592c91de39999a6aa72ed607729958e',
    mainFile: 'jmlr-style-file-master/sample.tex' },
  compile: { mainFile: 'jmlr-style-file-' + jmlrCommit + '/sample.tex', compileProfile: { engine: 'pdflatex', bibliography: 'bibtex' } },
  checks: { kind: 'latex-class', documentClass: 'article', options: ['twoside', '11pt'], package: 'jmlr2e',
    label: 'JMLR 文档类与样式', manualLabel: 'JMLR 投稿阶段要求', evidence: 'JMLR 作者指南',
    manualDetail: '请按当前投稿阶段核对页眉字段、作者信息、投稿材料及参考文献的著者—出版年格式。' },
} as const satisfies OfficialTemplateWorkflow

function wordWorkflow(version: string, original: OfficialFile, options: Partial<Pick<Extract<OfficialTemplateWorkflow, { kind: 'word' }>, 'updateLink' | 'guideline' | 'declaration' | 'blindCover' | 'checks' | 'njuptTrack'>> = {}) {
  return { kind: 'word', version, original, compile: wordLayoutCompile, checks: { kind: 'word-layout' }, ...options } as const
}

type ArchiveEntry = Extract<CatalogTemplate, { delivery: 'archive' }>
function archiveWorkflow(entry: Omit<ArchiveEntry, 'workflow'> & { downloadUrl: string }, options: Partial<Pick<ArchiveEntry['workflow'], 'checks' | 'prepare' | 'preview' | 'redirectHosts' | 'upstream' | 'entryFiles'>> = {}): ArchiveEntry {
  const { template, downloadUrl } = entry
  return { ...entry, workflow: { kind: 'zip', version: template.version, original: { url: downloadUrl, sha256: template.sha256 },
    compile: template, checks: { kind: 'manual' }, ...options } }
}

export const templateCatalog: readonly CatalogTemplate[] = [
  ...builtInCatalog,
  {
    id: 'suep-undergraduate', name: '上海电力大学 · 本科毕业设计', category: 'school', language: '简体中文', layout: 'thesis',
    keywords: suepKeywords, delivery: 'official', exportProfile: 'suep-undergraduate', sourceUrl: suepUndergraduateSource.page,
    workflow: { kind: 'word-import', profile: 'suep-undergraduate', compile: wordLayoutCompile, version: '2026-10-13',
      original: { url: suepUndergraduateSource.officialFiles[0].url, sha256: '3329bf614ad384bd8eeaf2e5e7ad52ea22122a90ca20c4ac203c522032880b18' },
      checks: { kind: 'suep' } },
    summary: '使用学校发布的 Word 原件。官方附件包内的第 7 项是带红色校徽的本科封面，最后保存于 2026-10-13。',
    sourceVersion: '本科封面 2026-10-13 版',
    verification: '已回归专用 Word 导入、官方校徽、封面、声明和正文 PDF。',
    sections: ['本科封面', '原创性及使用授权声明', '格式示范文本', '撰写规范'],
    officialFiles: suepUndergraduateSource.officialFiles,
    previewUrl: suepUndergraduateSource.emblemUrl,
    previewLabel: '官方封面中的校徽',
  },
  archiveWorkflow({
    id: 'aps-prl', name: 'Physical Review Letters · REVTeX', category: 'journal', language: 'English', layout: 'article',
    delivery: 'archive', exportProfile: 'prl-article', keywords: ['APS', 'PRL'], sourceVersion: 'REVTeX 4.2f · 2023-05-30',
    summary: 'APS 官方 apstemplate.tex，默认使用 prl 稿件选项。',
    sections: ['Abstract', 'Main text', 'References'],
    sourceUrl: 'https://journals.aps.org/revtex',
    requirementsUrl: 'https://journals.aps.org/prl/authors',
    requirementsLabel: 'PRL author instructions',
    downloadUrl: 'https://cdn.journals.aps.org/test/345f0cd4-cab7-4271-9a46-7331fb57618a/revtex-tds-2023-05-30.zip',
    verification: '已核对官方 ZIP、pdfLaTeX 与 BibTeX、独立稿件参考文献 PDF，以及 prl 选项检查。',
    manualReview: '文章类型、篇幅、补充材料和数据可用性声明请对照 PRL 投稿要求。',
    template: {
      id: 'aps-prl', name: 'Physical Review Letters · REVTeX', version: '4.2f', language: 'English', sections: [],
      mainFile: apsTemplate, compileProfile: { engine: 'pdflatex', bibliography: 'bibtex' },
      compileDescription: 'Local pdfLaTeX and BibTeX with the official REVTeX 4.2f distribution.',
      sha256: '2e749b136da5a551acb2d150dc186182cd5ee28d98570acff017f604f398bfc9',
    },
  }, { checks: { kind: 'prl' }, prepare: 'revtex' }),
  {
    id: 'suep-masters', name: '上海电力大学 · 硕士学位论文', category: 'school', language: '简体中文', layout: 'thesis',
    keywords: suepKeywords, delivery: 'official', exportProfile: 'official-thesis',
    workflow: wordWorkflow('试行', { url: 'https://yjsc.shiep.edu.cn/_upload/article/files/df/5f/6bdd106a40f7b9a02d39eb052877/ccb4d608-d4e7-4cc7-9165-c40c9cdc3e0f.doc',
      sha256: '2dc07056407097626e5a52043f6991e1613615ea6cb128532703745cded93cd4' }),
    summary: '研究生院发布的 Word 范本（试行），含学术型和专业型封面。请同时查看学校修订的写作规范。',
    sourceVersion: '研究生院试行 Word 范本',
    sections: ['封面与中英文扉页', '原创性声明', '版权使用授权书', '摘要', '正文示例'],
    sourceUrl: 'https://yjsc.shiep.edu.cn/7e/07/c955a228871/page.htm',
    requirementsUrl: 'https://xxgk.shiep.edu.cn/e3/99/c6178a254873/page.htm',
    requirementsLabel: '学校写作规范',
    previewUrl: 'https://yjsc.shiep.edu.cn/_upload/article/files/df/5f/6bdd106a40f7b9a02d39eb052877/c7af9e90-3061-438d-895f-c0ec309d1935.pdf',
    officialFiles: [{
      label: '研究生院范本 · 试行（DOC）',
      url: 'https://yjsc.shiep.edu.cn/_upload/article/files/df/5f/6bdd106a40f7b9a02d39eb052877/ccb4d608-d4e7-4cc7-9165-c40c9cdc3e0f.doc',
    }],
  },
  {
    id: 'scau-undergraduate', name: '华南农业大学 · 本科毕业论文', category: 'school', language: '简体中文', layout: 'thesis',
    delivery: 'official', exportProfile: 'official-thesis', keywords: ['SCAU', '华南农大'],
    workflow: wordWorkflow('2024-11-25', { url: 'https://jwc.scau.edu.cn/_upload/article/files/2f/ff/c054c83f44598e6dd4abaf401b15/2df06dd0-dfd0-4789-a972-fdc765bc9585.doc',
      sha256: '1f3e3be57848b3323aa5f971828fa9783b42eb7b6f0c39b33aae7659b1c421fd' }, { guideline: { url: 'https://jwc.scau.edu.cn/_upload/article/files/2f/ff/c054c83f44598e6dd4abaf401b15/5209358a-bbe5-4d16-b8ad-994b1a76497e.pdf', sha256: '54d8b5328b62fc5f4c5156fbc3fc28c7cc826c8e7efde1c0ad3b486bf0d85216' } }),
    summary: '教务处发布的本科毕业论文（设计）样例和附件。参考文献采用著者—出版年制。',
    sections: ['封面', '原创性与授权声明', '中英文摘要', '目录', '正文', '参考文献'],
    sourceUrl: 'https://jwc.scau.edu.cn/2024/1125/c5130a393741/page.htm',
    sourceVersion: '2024-11-25 发布页',
    verification: '已验收官方 Word 样例提取、版式复用、目录、图表和参考文献 PDF。',
    requirementsUrl: 'https://jwc.scau.edu.cn/_upload/article/files/2f/ff/c054c83f44598e6dd4abaf401b15/5209358a-bbe5-4d16-b8ad-994b1a76497e.pdf',
    requirementsLabel: '学校撰写规范附件',
    officialFiles: [{
      label: '教务处本科毕业论文 Word 样例',
      url: 'https://jwc.scau.edu.cn/_upload/article/files/2f/ff/c054c83f44598e6dd4abaf401b15/2df06dd0-dfd0-4789-a972-fdc765bc9585.doc',
    }],
  },
  {
    id: 'njupt-academic-masters', name: '南京邮电大学 · 学术硕士（自然科学）', category: 'school',
    language: '简体中文', layout: 'thesis', delivery: 'official', exportProfile: 'njupt-masters', keywords: ['NJUPT', '南邮'],
    workflow: wordWorkflow('2025-05-08', { url: njuptFiles + '0407effa-91c9-4124-913f-2fc7a15618ad.doc',
      sha256: '04355e77da3a92fbf0aa8ad5700c5ab94fe25a0c30c986733febc68d57b52fbe' }, { declaration: njuptDeclaration, updateLink: '南京邮电大学学术学位硕士研究生学位论文模板.*自然科学类' }),
    summary: '南京邮电大学研究生院发布的自然科学类学术学位硕士论文模板。',
    sections: ['中英文摘要', '目录', '正文', '图表', '参考文献'],
    sourceVersion: '2025-05-08 版 Word',
    verification: '已验收 Word 导入、罗马数字前置页、正文页码、左右页眉及图表编号。其余格式请对照学校标准。',
    sourceUrl: njuptPage,
    requirementsUrl: njuptGuide,
    requirementsLabel: '研究生学位论文撰写标准',
    officialFiles: [{
      label: '学术硕士自然科学类 Word 原件',
      url: njuptFiles + '0407effa-91c9-4124-913f-2fc7a15618ad.doc',
    }],
  },
  {
    id: 'njupt-humanities-masters', name: '南京邮电大学 · 学术硕士（人文社科）', category: 'school',
    language: '简体中文', layout: 'thesis', delivery: 'official', exportProfile: 'njupt-masters', keywords: ['NJUPT', '南邮'],
    workflow: wordWorkflow('2025-05-08', { url: njuptFiles + '9bd19f34-2ce3-4cf7-a1e4-f2749cad10f5.doc',
      sha256: 'bc229d9f6322db49ed9c4673f173cf7c91ddf44d5df1d9690b42e421a3765d5f' }, { declaration: njuptDeclaration, updateLink: '南京邮电大学学术学位硕士研究生学位论文模板.*人文社科类' }),
    summary: '南京邮电大学研究生院发布的人文社科类学术学位硕士论文模板。',
    sections: ['中英文摘要', '目录', '正文', '图表', '参考文献'],
    sourceVersion: '2025-05-08 版 Word',
    verification: '已用独立稿件核对 A4、标题、目录页码、正文页眉、图表编号及参考文献显示。',
    sourceUrl: njuptPage,
    requirementsUrl: njuptGuide,
    requirementsLabel: '研究生学位论文撰写标准',
    manualReview: '学位类别、官方封面和声明、签名、摘要页排版、盲审要求及参考文献著录细节。',
    officialFiles: [{ label: '学术硕士人文社科类 Word 原件', url: njuptFiles + '9bd19f34-2ce3-4cf7-a1e4-f2749cad10f5.doc' },
      { label: '原创性声明和使用授权声明', url: njuptFiles + '44f4a937-34f0-44e6-9642-092b23320dec.doc' }],
  },
  {
    id: 'njupt-professional-masters', name: '南京邮电大学 · 专业硕士（自然科学）', category: 'school',
    language: '简体中文', layout: 'thesis', delivery: 'official', exportProfile: 'njupt-masters', keywords: ['NJUPT', '南邮', '专业学位'],
    workflow: wordWorkflow('2025-05-08', { url: njuptFiles + 'f4ad7a70-88bd-4654-9384-6ed9f42bd5d2.doc',
      sha256: 'b6a4c0d6be8ece25067bf2fda3602ba35ccf8ea4f12663666ac651db8642a509' }, {
      declaration: njuptDeclaration, blindCover: njuptBlindCover, njuptTrack: 'professional', updateLink: '南京邮电大学专业学位硕士研究生学位论文模板.*自然科学类',
    }),
    summary: '研究生院发布的自然科学类专业学位硕士 Word。填写专业学位类别、培养类型和专业领域，中英文题名页使用官方原件。',
    sourceVersion: '2025-05-08 · 专业学位硕士自然科学类',
    sourceUrl: njuptPage, requirementsUrl: njuptGuide,
    requirementsLabel: '南京邮电大学研究生学位论文撰写标准',
    sections: ['中英文封面', '原创性与使用授权声明', '摘要', '目录', '正文', '参考文献'],
    officialFiles: [
      { label: '专业学位硕士自然科学类 Word 原件', url: njuptFiles + 'f4ad7a70-88bd-4654-9384-6ed9f42bd5d2.doc' },
      { label: '原创性声明和使用授权声明', url: njuptDeclaration.url },
      { label: '工程类专业学位类别和专业领域名称的中英文对照', url: njuptFiles + '0b98a4cc-2758-47a3-86ef-c1656a322533.pdf' },
    ],
  },
  {
    id: 'zju-basic-medicine-undergraduate', name: '浙江大学 · 基础医学本科毕业论文', category: 'school',
    language: '简体中文', layout: 'thesis', delivery: 'official', workflow: zjuWorkflow, exportProfile: 'zju-undergraduate', keywords: ['ZJU', '浙大', '基础医学院'],
    summary: '浙江大学基础医学院发布的 2022 级毕业论文 Word 原件，含封面、原创性声明、授权书和正文样例。',
    sections: ['封面与声明', '中英文摘要', '目录', '正文', '参考文献'],
    sourceVersion: '2026-09-01 发布页 · 2022 级基础医学',
    sourceUrl: 'https://bms.zju.edu.cn/2026/0901/c85146a3197941/page.htm',
    requirementsUrl: zjuWorkflow.guideline.url,
    requirementsLabel: '浙江大学本科毕业论文编写规则',
    officialFiles: [{ label: '基础医学院附件 6 · Word 原件', url: zjuWorkflow.original.url }],
    verification: '已用独立 Word 稿核对版式复用、A4、正文页边距和参考文献。',
    manualReview: '核对适用年级和专业、签署页和盖章、学院要求的装订顺序、参考文献格式及涉密稿件要求。',
  },
  {
    id: 'ustc-graduate-word', name: '中国科学技术大学 · 研究生学位论文', category: 'school',
    language: '简体中文', layout: 'thesis', delivery: 'official', exportProfile: 'official-thesis', keywords: ['USTC', '中科大', '中国科大'],
    workflow: wordWorkflow('2026-11-13', { url: 'https://gradschool.ustc.edu.cn/static/upload/article/file/1794538820307/1794538820307-053455.docx',
      sha256: '5153d853911ebf5b41c34112904c42b9f81223cc6a30aabedd62857bd88fbb33' }, { updateLink: '^\\s*中国科学技术大学研究生学位论文撰写模板\\s*$' }),
    summary: '研究生院发布的 2026 年 11 月 Word 原件，适用于博士和硕士研究生学位论文。',
    sections: ['封面与题名页', '声明', '中英文摘要', '目录', '正文', '参考文献'],
    sourceVersion: '2026-11-13 · 研究生院 Word',
    sourceUrl: 'https://gradschool.ustc.edu.cn/column/190',
    officialFiles: [{ label: '研究生院 Word 原件',
      url: 'https://gradschool.ustc.edu.cn/static/upload/article/file/1794538820307/1794538820307-053455.docx' }],
    verification: '已用独立 Word 稿核对摘要、目录和补白页的罗马数字页码，正文从奇数页起并从 1 编号，以及居中的章级页眉。',
    manualReview: '学位类型、题名页与签署声明、AI 使用声明、送审或涉密要求，以及参考文献著录细节。',
  },
  archiveWorkflow({
    id: 'agu-jgr-atmospheres', name: 'AGU · JGR: Atmospheres', category: 'journal',
    language: 'English', layout: 'article', delivery: 'archive', exportProfile: 'publisher-article', keywords: ['AGU', 'JGR', 'Atmospheres'],
    summary: 'AGU 官方 2025 LaTeX 类的 JGR: Atmospheres 配置，支持 Key Points、Plain Language Summary 和 Open Research。',
    sections: ['Key Points', 'Abstract', 'Plain Language Summary', 'Main text', 'Open Research Statement', 'References'],
    sourceUrl: 'https://www.agu.org/publications/authors/journals',
    requirementsUrl: 'https://www.agu.org/publications/authors/journals/submission-checklists',
    requirementsLabel: 'AGU submission checklists',
    downloadUrl: 'https://codeload.github.com/AGU-Publications/agujournal2025-latex-template/zip/355052226d872cf6b9211c12b73b2ed2da133a7d',
    sourceVersion: 'agujournal2025 · 3550522',
    manualReview: '请确认文章类型、Key Points、Plain Language Summary、数据与软件声明及投稿材料。',
    template: { id: 'agu-jgr-atmospheres', name: 'AGU · JGR: Atmospheres', version: '3550522',
      language: 'English', sections: [], mainFile: 'agujournal2025-latex-template-355052226d872cf6b9211c12b73b2ed2da133a7d/agujournaltemplate.tex',
      compileProfile: { engine: 'pdflatex', bibliography: 'bibtex' },
      compileDescription: 'pdfLaTeX and BibTeX with the official AGU class and apacite.',
      sha256: '7f429749e4795d54cde9c69d238f364e91f2dac85468476ebc77d78735230fa8' },
  }, {
    prepare: 'agu-journal', checks: { kind: 'agu-journal' }, entryFiles: ['agujournal2025.cls', 'tweaklist-git-moderncv-fixed.sty', 'agu-logo-large.pdf', 'agu-logo-small.pdf'],
    upstream: { url: 'https://codeload.github.com/AGU-Publications/agujournal2025-latex-template/zip/refs/heads/main',
      sha256: 'fa2cdf823f2d11e0fcee4d0078de4091778f8543e223eb181d9cc7cf82be4707', mainFile: 'agujournal2025-latex-template-main/agujournaltemplate.tex' },
  }),
  archiveWorkflow({
    id: 'mnras', name: 'Monthly Notices of the Royal Astronomical Society · MNRAS', category: 'journal',
    language: 'English', layout: 'columns', delivery: 'archive', exportProfile: 'publisher-article', keywords: ['MNRAS', 'RAS', 'astronomy'],
    summary: '英国皇家天文学会在 CTAN 发布的 MNRAS 期刊源包，正文默认双栏，含 BibTeX 样式和图表示例。',
    sections: ['Abstract', 'Keywords', 'Main text', 'Figures and tables', 'References'],
    sourceUrl: 'https://academic.oup.com/mnras/pages/general_instructions',
    requirementsUrl: 'https://tug.ctan.org/macros/latex/contrib/mnras/mnras_guide.pdf',
    requirementsLabel: 'MNRAS LaTeX author guide',
    downloadUrl: 'https://mirrors.mit.edu/CTAN/macros/latex/contrib/mnras.zip',
    sourceVersion: '3.2 · Royal Astronomical Society',
    verification: '已验收官方源包、独立稿的 PDF 正文双栏、图表及 BibTeX 参考文献。',
    manualReview: '超长公式单栏例外、文章类型、图件分辨率、补充材料及投稿系统字段。',
    template: { id: 'mnras', name: 'Monthly Notices of the Royal Astronomical Society · MNRAS', version: '3.2',
      language: 'English', sections: [], mainFile: 'mnras/mnras_template.tex',
      compileProfile: { engine: 'pdflatex', bibliography: 'bibtex' },
      compileDescription: 'Local pdfLaTeX and BibTeX with the official MNRAS class, NewTX fonts and required LaTeX packages.',
      sha256: '9d453e272a47648b4418b76577c82c331c0a1499a2a620676d3997f5104adf82' },
  }, { checks: { kind: 'mnras' } }),
  archiveWorkflow({
    id: 'elsevier-cas-sc', name: 'Elsevier · CAS 单栏期刊模板', category: 'journal',
    language: 'English', layout: 'article', delivery: 'archive', exportProfile: 'publisher-article', keywords: ['Elsevier', 'CAS', 'cas-sc'],
    summary: 'Elsevier 在 CTAN 发布的 CAS 单栏文章样例，使用 cas-sc 文档类和 CAS 著者—出版年文献样式。',
    sections: ['Author information', 'Abstract', 'Keywords', 'Main text', 'References'],
    sourceUrl: 'https://ctan.org/pkg/els-cas-templates',
    requirementsUrl: 'https://tug.ctan.org/macros/latex/contrib/els-cas-templates/doc/elsdoc-cas.pdf',
    requirementsLabel: 'Elsevier CAS template documentation',
    downloadUrl: 'https://mirrors.mit.edu/CTAN/macros/latex/contrib/els-cas-templates.zip',
    previewUrl: 'https://tug.ctan.org/macros/latex/contrib/els-cas-templates/cas-sc-sample.pdf',
    verification: '已核对官方源包、独立稿件的 pdfLaTeX 与 BibTeX 编译，以及 CAS 单栏文档类检查。',
    manualReview: '请核对目标期刊是否采用 CAS 单栏、参考文献体例、投稿阶段和期刊要求的附加材料。',
    template: { id: 'elsevier-cas-sc', name: 'Elsevier · CAS 单栏期刊模板', version: '2.4',
      language: 'English', sections: [], mainFile: 'els-cas-templates/cas-sc-sample.tex',
      compileProfile: { engine: 'pdflatex', bibliography: 'bibtex' },
      compileDescription: 'Local pdfLaTeX and BibTeX with Elsevier CAS and the TeX Live moreverb package.',
      sha256: '36d97da01c6bbd134f315bff6c3de553735e2550444a6ddd4f869ddc67a20757' },
  }, { checks: { kind: 'elsevier-cas' } }),
  {
    id: 'jmlr', name: 'Journal of Machine Learning Research · JMLR', category: 'journal',
    language: 'English', layout: 'article', delivery: 'archive', workflow: jmlrWorkflow, exportProfile: 'jmlr-article', keywords: ['JMLR', 'machine learning'],
    summary: 'JMLR 的官方 LaTeX 样例和 jmlr2e 样式，使用著者—出版年引用。',
    sections: ['Abstract', 'Keywords', 'Main text', 'Appendix', 'References'],
    sourceUrl: 'https://jmlr.org/format/format.html',
    requirementsUrl: 'https://jmlr.org/author-info.html',
    downloadUrl: jmlrWorkflow.original.url,
    previewUrl: 'https://raw.githubusercontent.com/JmlrOrg/jmlr-style-file/master/sample.pdf',
    verification: '已核对官方源包、pdfLaTeX 与 BibTeX 编译，以及文档类和 jmlr2e 样式。',
    manualReview: '投稿系统所需信息、投稿阶段所需的页眉字段、篇幅及附加材料。',
    template: { id: 'jmlr', name: 'Journal of Machine Learning Research · JMLR', version: jmlrWorkflow.version,
      language: 'English', sections: [], mainFile: jmlrWorkflow.upstream.mainFile,
      compileProfile: jmlrWorkflow.compile.compileProfile,
      compileDescription: 'Local pdfLaTeX and BibTeX with the official jmlr2e style.',
      sha256: jmlrWorkflow.upstream.sha256 },
  },
  {
    id: 'sjtu-graduate-word', name: '上海交通大学 · 研究生学位论文', category: 'school', language: '简体中文', layout: 'thesis',
    delivery: 'official', keywords: ['SJTU', '上海交大'], exportProfile: 'sjtu-graduate-word',
    workflow: wordWorkflow('2024-07-01', { url: 'https://www.gs.sjtu.edu.cn/storage/gs/web/cn/article/2024/07/8dff34547269297128145bdf67d7794b.docx',
      sha256: '22dfebf3332939293b1b08bb158fd479b7267162ffb63a82d95c3e8366c1a81f' }, { checks: { kind: 'sjtu-word' } }),
    summary: '研究生院发布的 Word 写作模板。学院可按学科制定具体格式。',
    sections: ['中英文摘要', '目录', '正文', '参考文献'],
    sourceVersion: '2024-07-01 Word 发布页 · 2025-11-24 撰写指南',
    sourceUrl: 'https://www.gs.sjtu.edu.cn/post/detail/Z3M2MjU',
    requirementsUrl: 'https://www.gs.sjtu.edu.cn/post/detail/Z3MzNDA0',
    requirementsLabel: '博士、硕士学位论文撰写指南',
    officialFiles: [{
      label: '研究生院 Word 原件',
      url: 'https://www.gs.sjtu.edu.cn/storage/gs/web/cn/article/2024/07/8dff34547269297128145bdf67d7794b.docx',
    }],
    verification: '已用独立稿件核对 Word 版式复用、A4、分节页码、正文左右页眉和参考文献显示。',
    manualReview: '学院细则、盲审要求、官方封面和摘要页页眉，以及参考文献著录细节。',
  },
  {
    id: 'acm-journal', name: 'ACM Journal Manuscript', category: 'journal', language: 'English', layout: 'article',
    delivery: 'official',
    workflow: { kind: 'reference' },
    summary: 'ACM’s Primary Article Template for journal submissions. Follow the review settings and variant specified by your journal.',
    sections: ['Abstract', 'ACM Reference Format', 'CCS Concepts', 'Keywords', 'Main text', 'References'],
    sourceUrl: 'https://www.overleaf.com/latex/templates/acm-journals-primary-article-template/cpkjqttwbshg',
    requirementsUrl: 'https://portalparts.acm.org/hippo/latex_templates/acmart.pdf',
    requirementsLabel: 'ACM 作者指南',
    previewUrl: 'https://www.overleaf.com/latex/templates/acm-journals-primary-article-template/cpkjqttwbshg.pdf',
    officialFiles: [],
  },
  archiveWorkflow({
    ...springerTemplate, category: 'journal', layout: 'columns', delivery: 'archive', exportProfile: 'publisher-article', template: springerTemplate,
    summary: 'Publisher authoring package. Confirm the target journal’s requirements before submission.',
    downloadUrl: 'https://cms-resources.apps.public.k8s.springernature.io/springer-cms/rest/v1/content/18782940/data/v12',
  }, { preview: 'external' }),
  archiveWorkflow({
    id: 'plos-one', exportProfile: 'publisher-article', name: 'PLOS ONE', category: 'journal', language: 'English', layout: 'article',
    summary: 'PLOS manuscript with its Vancouver reference style. Figures may need separate submission.',
    sections: ['Abstract', 'Introduction', 'Materials and methods', 'Results', 'Discussion', 'References'],
    sourceUrl: 'https://journals.plos.org/plosone/s/latex',
    downloadUrl: 'https://journals.plos.org/plosone/s/file?id=1457%2FPLOS_latex_template.zip',
    delivery: 'archive',
    template: { id: 'plos-one', name: 'PLOS ONE', version: '3.8 (2026-04)', language: 'English', sections: [],
      mainFile: 'plos_latex_template.tex', compileProfile: { engine: 'pdflatex', bibliography: 'auto' },
      compileDescription: 'Local pdfLaTeX. The official ZIP includes the PLOS bibliography style.',
      sha256: 'ea3a8a0fdbac77f95de47639541b09ef1583e059ace6783367490af9fa0b9a60' },
  }),
  archiveWorkflow({
    id: 'tsinghua-thesis', name: '清华大学 · ThuThesis', category: 'school', language: '简体中文', layout: 'thesis', community: true,
    exportProfile: 'thuthesis',
    summary: 'Community LaTeX template maintained by Tsinghua TUNA, with undergraduate, master’s and doctoral formats.',
    keywords: ['Tsinghua University', '清华'],
    sections: ['封面', '中英文摘要', '目录', '正文', '参考文献', '附录'],
    sourceUrl: 'https://github.com/tuna/thuthesis/releases/tag/v7.7.1', delivery: 'archive',
    requirementsUrl: 'https://edu.cs.tsinghua.edu.cn/cca/library/',
    requirementsLabel: 'Tsinghua writing guides and templates',
    downloadUrl: 'https://github.com/tuna/thuthesis/releases/download/v7.7.1/thuthesis-v7.7.1.zip',
    previewUrl: 'https://mirrors.mit.edu/CTAN/macros/latex/contrib/thuthesis/thuthesis-example.pdf',
    template: { id: 'tsinghua-thesis', name: '清华大学 · ThuThesis', version: '7.7.1', language: '简体中文', sections: [],
      mainFile: 'thuthesis-example.tex', compileProfile: { engine: 'xelatex', bibliography: 'bibtex' },
      compileDescription: 'Local XeLaTeX + BibTeX with CJK and XITS fonts.',
      sha256: 'ca8b0de4f7e770d8ab8d50870f7d3a800b5f8c0c5d049c83cf9cafc70142a26d' },
  }, { redirectHosts: ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'] }),
  archiveWorkflow({
    id: 'mit-thesis', exportProfile: 'mit-thesis', name: 'MIT Thesis', category: 'school', language: 'English', layout: 'thesis',
    summary: 'MIT Libraries thesis layout for graduate and undergraduate degrees.',
    sections: ['Title page', 'Committee', 'Abstract', 'Contents', 'Chapters', 'References'],
    sourceUrl: 'https://web.mit.edu/Thesis/tex/', delivery: 'archive',
    requirementsUrl: 'https://libraries.mit.edu/archives/thesis-specs/',
    requirementsLabel: 'MIT thesis specifications',
    downloadUrl: 'https://mirror.math.princeton.edu/pub/CTAN/macros/latex/contrib/mitthesis.zip',
    template: { id: 'mit-thesis', name: 'MIT Thesis', version: '1.24', language: 'English', sections: [],
      mainFile: 'mitthesis/MIT-thesis-template/MIT-Thesis.tex', compileProfile: { engine: 'lualatex', bibliography: 'auto' },
      compileDescription: 'External LuaLaTeX + Biber, as recommended by MIT. Export the external build ZIP from Prepare submission.',
      sha256: '6110fbe9361ed814e3caa395de3da76af39095d9e8bef99c8f0c299076dbb9a2' },
  }, { prepare: 'mit-thesis', preview: 'external' }),
  archiveWorkflow({
    id: 'ieee-compsoc', exportProfile: 'publisher-article', name: 'IEEE Computer Society Transactions', category: 'journal', language: 'English', layout: 'columns',
    summary: 'IEEEtran Computer Society journal example. Confirm the specific publication with the IEEE template selector.',
    sections: ['Abstract', 'Index terms', 'Introduction', 'Main text', 'References'],
    sourceUrl: 'https://ctan.org/pkg/ieeetran', delivery: 'archive',
    requirementsUrl: 'https://journals.ieeeauthorcenter.ieee.org/create-your-ieee-journal-article/authoring-tools-and-templates/tools-for-ieee-authors/ieee-article-templates/',
    downloadUrl: 'https://mirror.math.princeton.edu/pub/CTAN/macros/latex/contrib/IEEEtran.zip',
    template: { id: 'ieee-compsoc', name: 'IEEE Computer Society Transactions', version: '1.8b', language: 'English', sections: [],
      mainFile: 'IEEEtran/bare_jrnl_compsoc.tex', compileProfile: { engine: 'pdflatex', bibliography: 'auto' },
      compileDescription: 'Local pdfLaTeX with the IEEEtran class and standard TeX fonts.',
      sha256: 'e0cd4f5afbd42c8076092280e72b3e0a5111efe501d35de9f715cfb8da313cb4' },
  }),
  {
    id: 'science-aaas', name: 'Science · AAAS', category: 'journal', language: 'English', layout: 'article',
    workflow: { kind: 'reference' },
    summary: 'AAAS template for Science-family manuscripts. Consult the instructions for the specific journal and submission stage.',
    sections: ['Abstract', 'Main text', 'References', 'Acknowledgments', 'Figures and tables', 'Supplementary materials'],
    sourceUrl: 'https://www.overleaf.com/latex/templates/latex-template-for-science-family-journals/kjytmmfyxthd',
    requirementsUrl: 'https://www.science.org/content/page/preparing-manuscripts-using-latex',
    previewUrl: 'https://www.overleaf.com/latex/templates/latex-template-for-science-family-journals/kjytmmfyxthd.pdf',
    delivery: 'reference',
  },
]

export function catalogReleaseSource(entry: CatalogTemplate) {
  const { workflow, sourceUrl } = entry
  if (!sourceUrl || (workflow.kind !== 'word' && workflow.kind !== 'zip')) return
  const baseline = { id: entry.id, version: workflow.version, sha256: workflow.original.sha256 }
  if (workflow.kind === 'word') return { kind: workflow.kind, baseline, url: workflow.original.url,
    sourceUrl, guideline: workflow.guideline, declaration: workflow.declaration, blindCover: workflow.blindCover, updateLink: workflow.updateLink }
  return { kind: workflow.kind, baseline, url: workflow.upstream?.url ?? workflow.original.url,
    sourceUrl, pinnedUrl: workflow.upstream && workflow.original.url, equivalentBranchSha256: workflow.upstream?.sha256,
    redirectHosts: workflow.redirectHosts }
}

export async function importCatalogTemplate(entry: Extract<CatalogTemplate, { delivery: 'archive' }>, file: File, name: string, release?: TemplateOrigin) {
  const { template } = entry
  if (file.size > 128 * 1024 * 1024) throw new Error('Publisher ZIP exceeds the size limit.')
  const sha256 = await templateDigest(await file.arrayBuffer())
  const { workflow } = entry
  const original = !release && workflow.original.sha256 === sha256
  if (!original && sha256 !== (release?.sha256 ?? workflow.upstream?.sha256)) {
    throw new Error('This ZIP does not match the catalog version. Choose the linked package or use regular ZIP import.')
  }
  const checks = workflow.checks
  const requiredEntryFiles = workflow.entryFiles ?? (checks.kind === 'latex-class' ? [checks.package + '.sty'] : [])
  const possibleMain = release && workflow.upstream && requiredEntryFiles.length ? (project: ProjectFileSystem) => {
    const filename = workflow.compile.mainFile.split('/').at(-1)
    const paths = [...project.files.keys()].filter(path => path.split('/').at(-1) === filename
      && requiredEntryFiles.every(file => project.files.has(path.slice(0, path.lastIndexOf('/') + 1) + file)))
    if (paths.length !== 1) throw new Error('候选 ZIP 必须含一份可识别的入口及其同目录官方样式。')
    return paths[0]
  } : undefined
  const project = await openTemplateArchive(file, original ? { ...template, ...workflow.compile } :
    { ...template, mainFile: release ? template.mainFile : workflow.upstream?.mainFile ?? template.mainFile, version: release?.version ?? template.version }, name, sha256, possibleMain)
  if (workflow.prepare === 'revtex') {
    const main = project.files.get(apsTemplate)
    if (!main || main.type !== 'editable' || !main.content?.includes('\\bibliography{basename of .bib file}')) {
      throw new Error('The APS template is missing its expected bibliography placeholder.')
    }
    const content = main.content.replace('\\bibliography{basename of .bib file}', '\\bibliography{references}')
    const folder = apsTemplate.slice(0, apsTemplate.lastIndexOf('/') + 1)
    project.files.set(apsTemplate, { ...main, content, blob: undefined, size: new Blob([content]).size })
    const references = '% Add cited BibTeX entries here.\n'
    project.files.set(folder + 'references.bib', { path: folder + 'references.bib', name: 'references.bib', content: references,
      type: 'editable', mimeType: 'text/plain', size: new Blob([references]).size, metadata: { editable: true } })
    for (const [path, asset] of [...project.files]) {
      if (asset.type !== 'directory' && (path.startsWith(apsRoot + 'tex/latex/revtex/')
        || path === apsRoot + 'bibtex/bst/revtex/apsrev4-2.bst')) {
        const sourcePath = folder + asset.name
        project.files.set(sourcePath, { ...asset, path: sourcePath })
      }
    }
    return project
  }
  if (workflow.prepare === 'agu-journal') {
    const main = project.metadata.mainFile!
    const folder = main.slice(0, main.lastIndexOf('/') + 1)
    const file = project.files.get(main)
    if (file?.type !== 'editable' || !file.content) throw new Error('AGU 模板缺少可编辑的官方入口。')
    let content = file.content.replace(String.raw`\journalname{Journal name}`, String.raw`\journalname{Journal of Geophysical Research: Atmospheres}`)
    // The original draft class needs array's tabular support with current LaTeX kernels.
    if (!/\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\barray\b/.test(content)) {
      content = content.replace(/(\\documentclass\s*(?:\[[^\]]*\])?\s*\{agujournal2025\})/,
        '$1\n\\usepackage{array}')
    }
    if (content !== file.content) project.files.set(main, { ...file, content, blob: undefined, size: new Blob([content]).size })
    const bib = folder + 'wiley.bib'
    if (content.includes(String.raw`\bibliography{wiley}`) && !project.files.has(bib)) {
      // The upstream example refers to two demo citation keys without shipping their database.
      const examples = [
        '@article{CitekeyArticle, author={Shannon, Claude E.}, title={A Mathematical Theory of Communication},',
        '  journal={Bell System Technical Journal}, volume={27}, number={3}, pages={379--423}, year={1948}}',
        '@book{CitekeyBook, author={Wilks, Daniel S.}, title={Statistical Methods in the Atmospheric Sciences},',
        '  publisher={Elsevier}, edition={4}, year={2019}}', '',
      ].join('\n')
      project.files.set(bib, { path: bib, name: 'wiley.bib', content: examples, type: 'editable',
        mimeType: 'text/plain', size: new Blob([examples]).size, metadata: { editable: true } })
    }
    return project
  }
  if (workflow.prepare !== 'mit-thesis') return project
  const thesisClass = project.files.get('mitthesis/mitthesis.cls')
  if (!thesisClass || thesisClass.type === 'directory') {
    throw new Error('The MIT template is missing its class file.')
  }
  const classPath = 'mitthesis/MIT-thesis-template/mitthesis.cls'
  project.files.set(classPath, { ...thesisClass, path: classPath })
  return project
}
