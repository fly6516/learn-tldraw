export const suepUndergraduateId = 'suep-undergraduate'
export const suepUndergraduateOrigin = {
  id: suepUndergraduateId, version: '2026-10-13', sha256: '3329bf614ad384bd8eeaf2e5e7ad52ea22122a90ca20c4ac203c522032880b18',
} as const

export const suepUndergraduateSource = {
  page: 'https://xxgk.shiep.edu.cn/615/list.htm',
  officialFiles: [
    {
      label: '学校官方附件包 · 含 2026-10-13 版封面（RAR）',
      url: 'https://xxgk.shiep.edu.cn/_upload/article/files/37/c7/30eed380428bbbd7f390389bc4ec/76ac2adc-7920-4056-921c-b038658a282e.rar',
    },
    {
      label: '原创性及使用授权声明（DOC）',
      url: 'https://dqxb.shiep.edu.cn/_upload/article/files/03/4c/8939d01b4cfab25f7fcedb6e720e/6cabd04e-de72-437c-872f-07628c269e4f.doc',
    },
    {
      label: '学校格式示范文本（DOC）',
      url: 'https://dqxb.shiep.edu.cn/_upload/article/files/03/4c/8939d01b4cfab25f7fcedb6e720e/5efc3278-8a42-4529-9309-22e1158a5868.doc',
    },
    {
      label: '学校撰写规范（DOCX）',
      url: 'https://dqxb.shiep.edu.cn/_upload/article/files/03/4c/8939d01b4cfab25f7fcedb6e720e/87b1bd53-878e-4693-9a0e-d67be74528be.docx',
    },
  ],
  updateLink: '上海电力大学本科生毕业设计（论文）相关文件',
  emblemUrl: '/template-assets/suep-undergraduate-emblem.png',
} as const

export const suepDocxMembers = {
  guide: { name: '6.上海电力大学本科生毕业设计（论文）撰写规范.docx', sha256: '349dd0189406227e776fac8197c479dba80bc1b0679a9002821dae014d3804a4' },
  cover: { name: '7.上海电力大学毕业设计（论文）封面.doc', sha256: 'f06b20bacfc3181be5f7c443e37e940f604e1433b6bfeca79f63051c538ba42b' },
  body: { name: '14.上海电力大学本科生毕业设计（论文）格式示范文本.doc', sha256: '682978def76fb275f269355ea178fbbc06bd8ba1275d49d286bd93f5e45904ff' },
  declaration: { name: '17.上海电力大学毕业设计（论文）原创性及使用授权声明.doc', sha256: 'df4c2d2b90d0b3effb2d704a3c920a4fef2f5e8117850b411a7566302877beb8' },
} as const

export type SuepMember = keyof typeof suepDocxMembers
export const suepMemberRoles = ['guide', 'cover', 'body', 'declaration'] as const

export type SuepBundlePin = Pick<typeof suepUndergraduateOrigin, 'id'> & { version: string; sha256: string }
export type SuepBundleManifest = SuepBundlePin & {
  sourceUrl: string
  members: Record<SuepMember, { path: string; sha256: string }>
}
export type SuepBundleReceipt = { manifest: SuepBundleManifest; status: 'cache' | 'download' | 'upload' }
