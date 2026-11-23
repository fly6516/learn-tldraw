import JSZip from 'jszip'

// Synthetic sources for model and compiler acceptance tests.
const sources = {
  'main.tex': String.raw`\documentclass{article}
% Keep the demo usable with a minimal Tectonic cache.
\makeatletter
\renewcommand\section{\@startsection{section}{1}{0pt}{2ex}{1ex}{\normalfont\normalsize}}
\renewcommand\subsection{\@startsection{subsection}{2}{0pt}{1.5ex}{1ex}{\normalfont\normalsize}}
\makeatother
\renewcommand{\bfdefault}{m}
\renewcommand{\ttdefault}{\rmdefault}
\input{preamble}
\begin{document}
\begin{center}
\underline{Measuring Extreme Heat on the Walk to School}\\
Research Canvas demonstration paper
\end{center}
\input{sections/introduction}
\newpage
\input{sections/methods}
\newpage
\input{sections/results}
\input{sections/discussion}
\newpage
\appendix
\input{appendices/reproducibility}
\input{references/printed}
\end{document}
`,
  'preamble.tex': String.raw`\newcommand{\studyname}{Morning Walk Study}
\newcommand{\celsius}{\ensuremath{{}^{\circ}\mathrm{C}}}
\newtheorem{claim}{Claim}
\newenvironment{protocol}{\par\noindent}{\par}
\newenvironment{pseudocode}{\par\noindent}{\par}
`,
  'sections/introduction.tex': String.raw`\section{Introduction}
\label{sec:intro}
A cooler neighbourhood does not necessarily offer a cooler walk to school.
Route choice can concentrate exposure in short segments with little shade.
The \studyname{} compares two plausible routes across four morning survey periods.
We report exposure along the routes alongside the uncertainty introduced by sensor calibration.

Our design follows work on the local effects of urban trees and impervious surfaces\cite{ziter2019}.
The values in this paper are synthetic and illustrate the workflow. They do not describe a real school or neighbourhood.
`,
  'sections/methods.tex': String.raw`\section{Methods}
\label{sec:methods}
Observers traversed the shaded and exposed routes at the same planned departure time.
Each route was divided into ten equal-duration segments. For the main comparison, we first averaged within a session and then compared paired sessions.
\input{sections/calibration}
We summarize the paired temperature difference across the four sessions.
\begin{equation}
\label{eq:paired-gap}
\mbox{ΔT = Σ(T exposed − T shaded) / 4}
\end{equation}
`,
  'sections/calibration.tex': String.raw`\subsection{Sensor calibration}
\label{sec:calibration}
Before each walk, the sensors rested side by side for ten minutes. We computed the median paired difference over the final five minutes and subtracted it from the exposed-route readings.
We flagged sessions with more than two missing segments and tabulated the flags in the analysis notes. This prevents a long acquisition gap from appearing to be a cool stretch of pavement.
Background on the urban microclimate informs the choice of variables\cite{oke2017}.
`,
  'sections/results.tex': String.raw`\section{Results}
\label{sec:results}
The shaded route was cooler in each paired session. The largest gap appeared in the third session, when cloud cover remained low.
Figure~\ref{fig:route-temperatures} shows how the two routes changed over the four sessions. Table~\ref{tab:sessions} reports the same synthetic summaries for reuse.
\begin{figure}[ht]
\centering
\XeTeXpicfile "figures/route-temperatures.png" width 72mm
\caption{Relative route temperature. The upper trace is the exposed route and the lower trace is the shaded route.}
\label{fig:route-temperatures}
\end{figure}
\begin{table}[ht]
\centering
\begin{tabular}{c|rr}
Session & Shaded & Exposed \\
\hline
1 & 28.1 & 30.7 \\
2 & 27.5 & 29.9 \\
3 & 27.0 & 30.4 \\
4 & 26.7 & 29.1
\end{tabular}
\caption{Route temperatures in degrees Celsius.}
\label{tab:sessions}
\end{table}
`,
  'sections/discussion.tex': String.raw`\section{Discussion}
\label{sec:discussion}
The results support investigating shade at the route level. They do not establish how much new planting would change exposure, because buildings and walking speed were not independently varied.
The reported difference is an illustration, with too few sessions to estimate variation across seasons.
For a follow-up study, we would rotate the sensors between routes and pre-register the handling of missing observations. A regional heat assessment can help select additional routes\cite{epa2023}.
`,
  'appendices/reproducibility.tex': String.raw`\section{Reproducibility checklist}
\label{sec:repro}
The synthetic data are included in the project as data/sessions.csv. Start with the paired means, then compare the same summaries after removing each session in turn.
Record whether the direction of the difference changes. The downloadable project includes the source tree and the figure used to support this check.
\begin{pseudocode}
\label{alg:paired-summary}
Pair observations by session, average each route, then subtract the shaded mean.
\end{pseudocode}
\begingroup
\let\itshape\upshape
\begin{claim}
\label{claim:paired-sessions}
Pairing preserves the session identifiers needed to reproduce the comparison.
\end{claim}
\endgroup
\begin{protocol}
\label{protocol:calibration}
Record the offset and the number of missing segments for each instrument.
\end{protocol}
\begin{verbatim}
session,shaded_c,exposed_c
1,28.1,30.7
\end{verbatim}
`,
  'references/printed.tex': String.raw`\begin{thebibliography}{9}
\bibitem{ziter2019} C. D. Ziter et al. Scale-dependent interactions between tree canopy cover and impervious surfaces reduce daytime urban heat. PNAS, 2019.
\bibitem{oke2017} T. R. Oke et al. Urban Climates. Cambridge University Press, 2017.
\bibitem{epa2023} U.S. Environmental Protection Agency. Heat Island Compendium, 2023.
\end{thebibliography}
`,
  'references/library.bib': `@article{ziter2019,
  author = {Ziter, Carly D. and Pedersen, Eric J. and Kucharik, Christopher J. and Turner, Monica G.},
  title = {Scale-dependent interactions between tree canopy cover and impervious surfaces reduce daytime urban heat},
  journal = {Proceedings of the National Academy of Sciences},
  year = {2019}
}
@book{oke2017,
  author = {Oke, Timothy R. and Mills, Gerald and Christen, Andreas and Voogt, James A.},
  title = {Urban Climates},
  publisher = {Cambridge University Press},
  year = {2017}
}
@misc{epa2023,
  author = {{U.S. Environmental Protection Agency}},
  title = {Heat Island Compendium},
  year = {2023}
}
`,
  'data/sessions.csv': 'session,shaded_c,exposed_c\n1,28.1,30.7\n2,27.5,29.9\n3,27.0,30.4\n4,26.7,29.1\n',
  'protocol/calibration.txt': 'Morning Walk Study calibration checklist\nLog instrument offsets and flag missing segments.\n',
}

const plot = 'iVBORw0KGgoAAAANSUhEUgAAAPAAAABkCAAAAACdyeIbAAABoElEQVR4nO3YbXLDIAxF0Swlq2F12mRWok7STwx1DAgZPb/7r5OW4RRsE9/0Yt3OnoB3BKNHMHoEo0cwelXw3X8ebhGsBGNFsBKMFcF6eXBKyW02DtXBj7z06hEvLWvY0i919ZNItV7DKTq776Y1i+3w7xy5S5vNLn3386PFqPWGH0v9i5I2zu1nPWO+z+g53KDeYRa/2DyP91kePHYdh52bP+qbyv/Zn7Qy1t62PT7cyHS2zTpaDjKLwWwGCnSWNjNHAZuZA4FtLuhYYB1f6HjgQXNI8MjmjgrW3oWODO4yBwe3b+74YG1b6EPvtCJUfeemZRgr3BDBSjBWBCvBWBGsBGNFsF4eLCLiNp35HVth+cxlRpNr2tII7p5rOLR74KYV0z1+lw7mNnssRXFbv9P6cvcPYJqWTTp4yLILPvmkJcvJvY6Wsgrd/yx9svzELw/nyFf4tuS63VcA/ybz7WuB/yRZduMuC86z4wcB543wQ4Lz2uAA4LYIVoKxIlgJxorgZ3eUjoKRIxg9gtEjGD2C0SMYPYLRIxg9gtEjGL0PPk9w6zK9+AwAAAAASUVORK5CYII='

export async function morningWalkZip() {
  const zip = new JSZip()
  for (const [path, text] of Object.entries(sources)) zip.file(path, text)
  zip.file('figures/route-temperatures.png', plot, { base64: true })
  return zip.generateAsync({ type: 'nodebuffer' })
}
