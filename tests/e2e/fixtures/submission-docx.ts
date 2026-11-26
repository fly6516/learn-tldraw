import JSZip from 'jszip'
import sharp from 'sharp'

export const docxFields = {
  title: '三通道测量系统的可复现校准',
  author: '周若宁', studentNumber: '20260001', advisor: '陈示范',
  program: '2022级', affiliation: '验收示例学院', date: '2026年11月26日',
  chineseAbstract: '本研究以独立的三通道测量为例，检查实验部署、误差记录和复验流程。全部测量采用相同的参考值和采样间隔，以便完整比较各通道的响应。本文还包含可以更新的图表编号、正文引用和参考文献，用于对照高校论文提交版的导出效果。',
  chineseKeywords: '校准；测量；重复性', englishKeywords: 'calibration; measurement; reproducibility',
  acknowledgment: '感谢验收团队对测量记录的核对。',
}
const chapters = [
  ['测量方案', ['仪器配置', '采样条件', '校准步骤', '单位换算']],
  ['独立复验', ['数据采集', '交叉验证', '结果记录', '误差估计']],
  ['结果整理', ['观察范围', '通道对比', '偏差统计', '鲁棒分析']],
  ['归档检查', ['数据完整性', '变量复核', '引用核查', '交付说明']],
  ['结果讨论', ['误差来源', '复现实验', '适用范围', '研究结论']],
] as const
const longTail = chapters.map(([title, headings]) => '\\section{' + title + '}\n' + headings.map(name =>
  '\\subsection{' + name + '}\n按相同方案记录测量结果，以便复核本节所列观察。\n' +
  '\\subsubsection{' + name + '的复验记录}\n独立复验包含可核对的测量标签与简明记录。\n').join('\n')).join('\n')
export const docxManuscript = `\\documentclass{article}
\\usepackage{graphicx,booktabs,amsmath,natbib,hyperref}
\\title{Reproducible Calibration of Three Measurement Channels}
\\author{周若宁}
\\begin{document}
\\maketitle
\\begin{abstract}
We compare independent observations from three measurement channels against a common calibration procedure. The experiment is repeatable under a controlled sampling interval.
\\end{abstract}

\\section{实验设计}\\label{sec:study}
本研究通过统一流程采集数据。详见第~\\ref{sec:study}~章、图~\\ref{fig:channels}~和表~\\ref{tab:counts}（见第~\\pageref{tab:counts}~页）。
测量过程参考了信息理论的早期研究\\citep{shannon1948}，并采用树结构近似方法\\citep{chow1968}。独立复核方案参照后续讨论\\citep{cover2006}。

\\subsection{观测方案}
以同样的采样间隔记录测量，并利用公式 $x=\\frac{1}{2}$ 核对换算。
\\[
y=\\sqrt{x^2+1}
\\]

\\subsubsection{重复性检查}
验收稿的标识句：以独立测量核对三个通道的校准结果。

\\begin{figure}
\\centering
\\includegraphics[width=.55\\linewidth]{figures/channels.png}
\\caption{三个测量通道的独立校准结果}\\label{fig:channels}
\\end{figure}

\\begin{table}
\\centering
\\caption{独立观测样本数量}\\label{tab:counts}
\\begin{tabular}{lr}
\\toprule
通道 & 观测数量 \\\\
\\midrule
Alpha & 12 \\\\
Beta & 16 \\\\
Gamma & 20 \\\\
\\bottomrule
\\end{tabular}
\\end{table}

${longTail}

\\bibliographystyle{plainnat}
\\bibliography{refs/measurement}
\\end{document}
`
const bib = `
@book{cover2006, author={Cover, Thomas M. and Thomas, Joy A.}, title={Elements of Information Theory}, edition={2},
  address={Hoboken}, publisher={Wiley}, year={2006}}
@article{chow1968, author={Chow, C. K. and Liu, C. N.}, title={Approximating Discrete Probability Distributions with Dependence Trees},
  journal={IEEE Transactions on Information Theory}, year={1968}, volume={14}, number={3}, pages={462--467}}
@article{shannon1948, author={Shannon, Claude E.}, title={A Mathematical Theory of Communication},
  journal={Bell System Technical Journal}, year={1948}, volume={27}, number={3}, pages={379--423}}
`

export async function docxFixture(manuscript = docxManuscript) {
  const zip = new JSZip()
  zip.file('main.tex', manuscript)
  zip.file('refs/measurement.bib', bib)
  zip.file('figures/channels.png', await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240">' +
    '<rect width="480" height="240" fill="white"/><path d="M54 20v182h394" fill="none" stroke="#253551"/>' +
    '<path d="M88 201V111h73v90 M205 201V72h73v129 M322 201V38h73v163" fill="#824cc4"/>' +
    '<g font-family="Arial" font-size="14" fill="#253551"><text x="106" y="226">Alpha</text><text x="222" y="226">Beta</text><text x="335" y="226">Gamma</text></g></svg>',
  )).png().toBuffer())
  return zip.generateAsync({ type: 'nodebuffer' })
}

export const docxAppendixManuscript = docxManuscript
  .replace('本研究通过统一流程采集数据。', '本研究通过统一流程采集数据。复验材料见附录~\\ref{app:measurements}。')
  .replace('\\end{document}', `\\appendix
\\section{原始测量记录}\\label{app:measurements}
附录核验句：保留所有原始通道记录。

\\subsection{记录说明}
同一通道的数据按日期核查。

\\section{独立复核清单}\\label{app:checklist}
第二附录核验句：逐项复核记录。
\\end{document}`)

export const docxEquationManuscript = docxAppendixManuscript
  .replace('本研究通过统一流程采集数据。', '本研究通过统一流程采集数据。计算见式~\\eqref{eq:calibration} 和式~\\eqref{eq:repeat}。')
  .replace(`\\[
y=\\sqrt{x^2+1}
\\]`, `
\\begin{equation}
y=\\sqrt{x^2+1}\\label{eq:calibration}
\\end{equation}
`)
  .replace('\\section{测量方案}', `\\section{测量方案}

\\begin{equation}
z=x+y\\label{eq:repeat}
\\end{equation}
`)

const longTableRows = Array.from({ length: 110 }, (_, index) => `通道记录${index + 1} & ${index + 12} \\\\`).join('\n')
export const docxLongTableManuscript = docxEquationManuscript
  .replace('amsmath,natbib,hyperref', 'amsmath,natbib,hyperref,longtable')
  .replace('复验材料见附录~\\ref{app:measurements}。', '复验材料见附录~\\ref{app:measurements}，原始数据见表~\\ref{tab:long-channels}。')
  .replace('同一通道的数据按日期核查。', `同一通道的数据按日期核查。

\\begin{longtable}{lr}
\\caption{跨页通道原始数据}\\label{tab:long-channels}\\\\
\\toprule
通道记录号 & 测量计数 \\\\
\\midrule
\\endhead
${longTableRows}
\\bottomrule
\\end{longtable}

长表之后的独立核验句。
`)
