type ManualCheck = { id: string; label: string; detail: string; evidence: string; sourceUrl: string }

const njuptChecks: ManualCheck[] = [
  { id: 'njupt-declaration-signatures', label: '南邮声明签署', detail: '按本次提交类型核对原创性声明和使用授权声明的签字栏、签署人和日期。',
    evidence: '南邮研究生院 · 学术硕士模板及声明附件', sourceUrl: 'https://pg.njupt.edu.cn/2025/0530/c978a284783/page.htm' },
  { id: 'njupt-department-review', label: '南邮院系与送审要求', detail: '确认所在培养单位现行补充要求，按本次提交类型核对匿名处理、附件和提交材料。',
    evidence: '南邮研究生学位论文撰写标准及所在培养单位的当期通知', sourceUrl: 'https://pg.njupt.edu.cn/2009/1119/c14020a14690/page.htm' },
]

const checks: Readonly<Record<string, readonly ManualCheck[]>> = {
  'njupt-academic-masters': njuptChecks,
  'njupt-humanities-masters': njuptChecks,
  'njupt-professional-masters': [...njuptChecks, {
    id: 'njupt-professional-fields', label: '南邮专业学位类别和领域', detail: '核对专业学位类别、培养类型和专业领域的中英文，确认正文记录了与实际应用相关的工程实践。',
    evidence: '南邮研究生院 · 专业学位硕士 Word 与中英文对照附件', sourceUrl: 'https://pg.njupt.edu.cn/2025/0530/c978a284783/page.htm',
  }],
  'suep-masters': [
    { id: 'suep-masters-signatures', label: '上电硕士声明签署', detail: '核对原创性声明与版权使用授权书的签署要求，确认正式提交稿上的签字和日期。',
      evidence: '上电研究生院 · 硕士（博士）学位论文范本（试行）', sourceUrl: 'https://yjsc.shiep.edu.cn/7e/07/c955a228871/page.htm' },
    { id: 'suep-masters-department-review', label: '上电硕士院系与送审要求', detail: '按修订规范及所在学院通知确认学位类别、送审时的匿名处理、装订和附件要求。',
      evidence: '上电 · 研究生学位论文撰写规范及所在学院的当期通知', sourceUrl: 'https://xxgk.shiep.edu.cn/e3/99/c6178a254873/page.htm' },
  ],
  'ustc-graduate-word': [
    { id: 'ustc-signatures', label: '中科大声明签署', detail: '按学位和提交阶段要求核对原创性声明、授权声明及需要另交的声明材料。',
      evidence: '中科大研究生院 · 学位论文模板和学位申请材料', sourceUrl: 'https://gradschool.ustc.edu.cn/column/190' },
    { id: 'ustc-department-review', label: '中科大培养单位与送审要求', detail: '确认所在培养单位的当期提交清单以及适用于本稿的送审或涉密要求。',
      evidence: '中科大研究生院 · 学位授予及所在培养单位的当期通知', sourceUrl: 'https://gradschool.ustc.edu.cn/column/190' },
    { id: 'ustc-ai-disclosure', label: '中科大 AI 使用声明', detail: '按论文形成过程中的实际使用情况核对是否需要披露及披露位置、内容。勾选只记录作者已核对。',
      evidence: '中科大研究生院发布的人工智能工具使用指南', sourceUrl: 'https://gradschool.ustc.edu.cn/static/upload/article/file/1779088544462/1779088544462-671405.pdf' },
  ],
}

export function thesisManualChecks(templateId?: string) {
  return templateId && Object.hasOwn(checks, templateId) ? checks[templateId] : []
}
