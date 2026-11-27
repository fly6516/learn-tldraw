# 模板支持与验证

在项目列表打开 **Paper templates**。可创建条目通过 **使用模板** 打开 Word 版式对照、上电本科专用导入或 LaTeX 创建流程。参考条目打开发布方资料。Word 模板使用你上传的独立稿件。官方样例正文只用于读取版式。获取失败时，可通过界面上传与所选版本校验值相符的原件。

## 目录支持

**实测**表示用独立稿运行过表中列出的流程。**待确认**表示按提交阶段由作者核对，或缺少相应环境的验证。**不适用**表示该条目没有此功能。表中显示的是目录登记版。完整下载地址、入口文件、引擎、检查规则和 SHA-256 以[模板目录配置](../src/lib/project/template-catalog.ts)及[上电原件配置](../src/lib/project/suep-undergraduate-source.ts)为准。发布方可能更新文件，登记版本不会自动随之变化。

| 模板与来源 | 登记版 | 创建、编译和切换 | 待确认 |
| --- | --- | --- | --- |
| English article、中文通用论文，内置 | 1.0.0 | 实测创建 PDF、切换和双向定位。中文用 XeLaTeX。 | 目标学校或期刊的要求。 |
| [上电本科](https://xxgk.shiep.edu.cn/615/list.htm) | 2026-10-13 | 实测专用 Word 导入、XeLaTeX、切换和双向定位。核对了红色校徽、封面和两页声明。 | 封面字段、签署和学院材料。 |
| [上电硕士](https://yjsc.shiep.edu.cn/7e/07/c955a228871/page.htm) | 试行 | 实测 Word、XeLaTeX、切换和双向定位，含题名页和声明。 | 学位类别、签署和送审。 |
| [华南农大本科](https://jwc.scau.edu.cn/2024/1125/c5130a393741/page.htm) | 2024-11-25 | 实测 Word 与规范 PDF 独立校验、XeLaTeX、切换和双向定位。 | 著者—出版年著录、声明和学院细则。 |
| [南邮学术硕士，自然科学及人文社科](https://pg.njupt.edu.cn/2025/0530/c978a284783/page.htm) | 2025-05-08 | 两套均实测 Word、XeLaTeX、切换、双向定位和模拟发布回退。 | 学位与学院封面、签署、送审和著录。 |
| [南邮专业硕士，自然科学](https://pg.njupt.edu.cn/2025/0530/c978a284783/page.htm) | 2025-05-08 | 实测 Word、XeLaTeX、切换及双向定位，含带校徽的题名页。 | [撰写标准](https://pg.njupt.edu.cn/2009/1119/c14020a14690/page.htm)、工程实践及当期正式归档字体。 |
| [浙大基础医学本科](https://bms.zju.edu.cn/2026/0901/c85146a3197941/page.htm) | 2026-09-01 | 实测 Word 与规范 PDF 分别校验、XeLaTeX、切换和双向定位。核对章起页、目录、页眉及题注。 | 适用年级、签署和装订。页眉建议以规则对照所标的来源为准。 |
| [中科大研究生](https://gradschool.ustc.edu.cn/column/190) | 2026-11-13 | 实测 Word、XeLaTeX、切换和双向定位，含罗马数字前置页、奇数页起正文与章页眉。 | 培养单位、签署、AI 使用声明和涉密要求。 |
| [上交大研究生](https://www.gs.sjtu.edu.cn/post/detail/Z3M2MjU) | 2024-07-01 | 实测工学硕士 Word、XeLaTeX、切换、双向定位及候选发布。 | 院系及学位字段。带独立自定义封面或校徽的候选暂不支持切换。 |
| [ThuThesis 社区版](https://github.com/tuna/thuthesis/releases/tag/v7.7.1) | 7.7.1 | 实测硕士场景，XeLaTeX、切换和双向定位，含中英文封面。 | 学位、院系规定和字体。 |
| [MIT Thesis](https://web.mit.edu/Thesis/tex/) | 1.24 | 实测外部 LuaLaTeX、Biber、登记版切换和双向定位。 | [MIT Libraries 规范](https://libraries.mit.edu/archives/thesis-specs/)、签署、学位字段与 PDF/A。 |
| [PRL REVTeX](https://journals.aps.org/revtex) | 4.2f | 实测 pdfLaTeX、切换、双向定位、候选发布及两个提交阶段。 | [APS 提交要求](https://journals.aps.org/authors/web-submission-guidelines-physical-review)、篇幅和补充材料。 |
| [JMLR](https://jmlr.org/format/format.html) | `f413f63` | 实测固定提交 ZIP、pdfLaTeX、切换、双向定位及候选发布。使用 `jmlr2e`。 | 投稿阶段、作者与页眉信息。 |
| [AGU JGR: Atmospheres](https://github.com/AGU-Publications/agujournal2025-latex-template) | `3550522` | 实测 pdfLaTeX、切换、双向定位及同提交 ZIP 识别。使用官方 `agujournal2025` 类。 | [AGU 提交清单](https://www.agu.org/publications/authors/journals/submission-checklists)、数据和软件声明、生产图件。 |
| [MNRAS](https://academic.oup.com/mnras/pages/general_instructions) | 3.2 | 实测 pdfLaTeX、双栏、文献、切换和双向定位。 | 单栏例外、图件和文章类型。 |
| [Elsevier CAS 单栏](https://ctan.org/pkg/els-cas-templates) | 2.4 | 实测 pdfLaTeX、单栏文档类、切换和双向定位。 | 目标期刊的文档类、引文和附件。 |
| [PLOS ONE](https://journals.plos.org/plosone/s/latex) | 3.8（2026-04） | 实测 pdfLaTeX、Vancouver 引用、切换和双向定位。 | 图件单独交付及著录细节。 |
| [IEEE Computer Society](https://ctan.org/pkg/ieeetran) | 1.8b | 实测 pdfLaTeX、IEEEtran 双栏、切换和双向定位。 | 目标期刊是否采用 Computer Society 版式。 |
| [Springer Nature](https://www.springernature.com/in/authors/campaigns/latex-author-support) | 2024-12 | 实测外部 pdfLaTeX 与 EPS 图件创建、候选 PDF 回传、本机切换和双向定位。 | 期刊类选项、引用体例和声明。 |
| [ACM](https://www.overleaf.com/latex/templates/acm-journals-primary-article-template/cpkjqttwbshg)、[Science · AAAS](https://www.overleaf.com/latex/templates/latex-template-for-science-family-journals/kjytmmfyxthd) | 不适用 | 实测参考入口。创建、切换、编译及投稿阶段不适用。 | 按目标刊物获取原件和指南。 |

## 版本、换版和恢复

- **管理官方版本**检查登记下载地址或发布页附件。载入候选后先编译预览，再确认发布。旧项目和归档依所保存的版本和 SHA-256 复查。候选模拟件是测试数据。JMLR 和 AGU 按固定提交创建，并检查上游分支。同一提交的两种 ZIP 可以具有不同的 SHA-256。
- Word 的规范、声明或盲审封面可能单独变化。发布记录保存每个附件的角色、来源和 SHA-256，以及清单、编译和适用的 Word 验收记录。浙大实测只换规范 PDF，南邮专硕实测只换声明。两例核对了创建、切换、DOCX、断网恢复和旧档。浙大用例还以有明确标记的冲突样本核对用户选择确实改变编译结果。规范选项显示原文来源及可识别的物理页码。
- 上电本科的登记 RAR 含第 6 项规范、第 7 项封面、第 14 项正文示范及第 17 项声明。创建、切换和 DOCX 共享校验缓存。实测首次获取、缓存命中、离线读取、损坏恢复和手动回退。默认缓存为 `.cache/official-templates/`，上电根目录可用 `SUEP_TEMPLATE_CACHE_DIR` 指定。
- **更换模板**先预览，再选择**设为当前模板**。切换预览可以定位缺失素材或无法移植的 TeX 命令。遇到专属命令时可按原模板编译。有切换验收的候选才会作为相应的可切换版本提供。
- MIT Thesis 切换时下载外部构建 ZIP，解压后运行 `node compile-mit.mjs`。用 Node.js、LuaLaTeX、Biber 和 latexmk 构建，再回传同次生成的 PDF、SyncTeX 和编译记录。源文件改变或换设备后需要重新准备和回传。Springer 目录原件及候选可使用外部编译。项目备份操作见[恢复指南](project-recovery.md)。

## 提交、归档和 Word

在 **Writing → Prepare submission** 选择提交阶段。预检针对当前编译源 ZIP，报告记录源包、PDF、模板和附件的校验值。改稿使当前结果失效，历史归档仍可复查。外部构建需作者核对回传的 PDF 对应下载的源包。签署、盲审、数据声明和具体期刊附加材料仍需核对。

- **导出 Word（DOCX）**支持浙大基础医学本科、上电本科和南邮专业硕士正式归档。独立稿在 Microsoft Word for Mac 16.115.2 实测打开、更新整份目录和正文引用、保存与重开。样稿覆盖封面、空白签名栏、分节与页码、图表、文献及适用的可编辑公式。保存后的 Word 文件可附入归档。Word for Windows 与 WPS 待确认。
- 在 Word 更新目录与正文域，检查实际页码、跳转、字体和题注。跨章移动图表或改变文献引用顺序后，从项目重新生成。部分自定义宏、图形或公式结构无法可靠转换时，导出会提示对应位置。以导出界面和独立稿回归覆盖范围为准。
- **南邮盲审**的正式交付仅提供匿名 PDF。身份字段、结构化致谢及实名声明退出盲审输出。图像、成果附件和元数据里的身份线索仍由作者复核。正式归档字体应按学校规定，在合法字体可用的环境复验嵌入结果。[送审通知](https://pg.njupt.edu.cn/2026/0313/c1049a297791/page.htm)
- **AGU 初投与修回**实测清洁稿、适用的分阶段检查、编译源包与历史归档。修回可将已核验回复生成 PDF，与作者上传的对照稿、同轮清洁稿一起归档。作者负责确认修订标记确实对应这两版。操作见[修订包指南](revision-package.md#agu-revised-submission)。

## 复现

从仓库根目录运行。准备 Chromium、Firefox、Tectonic、LibreOffice、Pandoc、TeX Live（含 XeLaTeX、pdfLaTeX、LuaLaTeX、BibTeX、Biber、latexmk 及模板依赖）、Poppler、Ghostscript 和 bsdtar。精简 TeX Live 环境可按运行器提示安装缺失宏包。Word 实机测试另需 macOS 上已安装的 Microsoft Word。

```sh
bun install --frozen-lockfile
bunx playwright install chromium firefox
bun run build
LATEX_SYSTEM_TEX_ENABLED=1 RESEARCH_SUBMISSION_CATALOG_ACCEPTANCE=1 bun run test:templates all
LATEX_SYSTEM_TEX_ENABLED=1 RESEARCH_DOCX_WORD_NATIVE=1 bun run test:templates attachments
```

用 `catalog`、`switch`、`release`、`manual`、`expansion` 或 `attachments` 替换 `all` 运行相应分组。上一次目录验收覆盖 21 个可创建模板及两个参考条目，包含创建、切换、确认发布和归档用例。以上状态描述的是已有验收范围。新的环境可以用相同入口生成自己的结果。

直接运行专项时，启用 `WORD_IMPORT_ENABLED=1`、`LATEX_COMPILE_ENABLED=1` 和 `LATEX_SYSTEM_TEX_ENABLED=1`。若工作台已启动，可将 `RESEARCH_TRIAL_E2E_URL` 指向它的回环 origin（不带路径）。从仓库根目录用 `bun run test:e2e <测试文件> --workers=1` 运行。

运行器按 SHA-256 获取登记附件，并从[独立稿](../tests/e2e/fixtures/official-template-acceptance/catalog-manuscript.md)生成 Word。服务器或上游不可用时，可将已经校验的登记文件放进 `.cache/template-acceptance/`，或用 `RESEARCH_TEMPLATE_ACCEPTANCE_FIXTURES` 指定缓存目录。文件名与校验值见失败提示。测试报告默认写入忽略的 `test-results/template-acceptance/`，可用 `RESEARCH_TEMPLATE_ACCEPTANCE_OUTPUT` 指定其他本地目录。测试生成的 PDF、备份和附件留在本地。

- [浙大和 Elsevier 专项](../tests/e2e/official-template-acceptance.spec.ts)使用 `RESEARCH_OFFICIAL_TEMPLATE_FIXTURES`。将浙大附件 6 和 7 保存为 `zju.docx` 和 `zju-guide.pdf`，把 CAS 登记 ZIP 保存为 `elsevier.zip`。用 `pandoc tests/e2e/fixtures/official-template-acceptance/zju-manuscript.md -o "$RESEARCH_OFFICIAL_TEMPLATE_FIXTURES/zju-manuscript.docx"` 生成独立稿。
- [规范对照](../tests/e2e/official-guidelines.spec.ts)同时使用上述浙大目录及 `RESEARCH_OFFICIAL_EXPANSION_FIXTURES`。在后者放入 `njupt-humanities.doc` 和 `requirements.pdf`。其中 PDF 是研究生院[网页撰写标准](https://pg.njupt.edu.cn/2009/1119/c14020a14690/page.htm)的测试用 PDF。复跑[南邮/JMLR 专项](../tests/e2e/official-catalog-expansion.spec.ts)另需独立的 `humanities-manuscript.docx`，以及分别从登记分支和固定提交获取的 `jmlr.zip` 与 `jmlr-pinned.zip`。
- [中科大和 MNRAS 专项](../tests/e2e/graduate-journal-acceptance.spec.ts)使用 `RESEARCH_GRADUATE_JOURNAL_FIXTURES`。放入 `ustc-2026-11.docx`、`mnras.zip`，并用 Pandoc 将同一独立样例转换成 `ustc-manuscript.docx`。
- [上电缓存专项](../tests/e2e/suep-official-cache.spec.ts)需要已校验的 RAR、隔离的 `SUEP_TEMPLATE_CACHE_DIR`、`RESEARCH_SUEP_UPSTREAM_STATE` 和已启动的回环服务。服务用 `NODE_OPTIONS` 加载[模拟上游](../tests/e2e/fixtures/suep-upstream.cjs)。仅在打算访问真实学校站点时启用 `RESEARCH_SUEP_LIVE=1`。
- [浙大和上电 DOCX 专项](../tests/e2e/submission-docx.spec.ts)设置 `RESEARCH_SUBMISSION_DOCX_ACCEPTANCE=1` 和 `RESEARCH_TEMPLATE_PINNED_FIXTURES`。测试所需文件名见用例。南邮和 AGU 的[分阶段测试](../tests/e2e/template-export.spec.ts)同样使用已校验原件目录，另设置 `RESEARCH_TEMPLATE_EXPORT_ACCEPTANCE=1`，以 `-g 'submission stage'` 筛选。Word 实机复验另设置 `RESEARCH_DOCX_WORD_NATIVE=1`。
- 严格的南邮归档字体检查需合法安装的 SimSun、SimHei 和 Times New Roman。可用 `LATEX_LOCAL_CJK_FONT_DIR` 指定已授权的本机字体目录，并在分阶段测试中设置 `RESEARCH_NJUPT_REQUIRE_DEPOSIT_FONTS=1`，以 `-g 'validates njupt submission stage delivery'` 筛选。macOS 手动运行工作台时可将 `FONTCONFIG_FILE` 设为[仓库里的字体映射](../tests/e2e/fixtures/official-template-acceptance/macos-fonts.conf)在本机的路径。
