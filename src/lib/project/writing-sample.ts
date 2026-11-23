export const writingSampleFiles = ['sections/methods.tex', 'sections/results.tex']
export const writingSampleSubmission = 'Practice submission'
export const writingSamplePrompt = `Revise sections/methods.tex and sections/results.tex, compile the manuscript, and prepare the submission named "${writingSampleSubmission}". In Methods replace "We recorded a temperature for each synthetic observation." with "We recorded one temperature per synthetic observation." In Results replace "The synthetic observations had an average of twenty degrees." with "The mean temperature of the synthetic observations was twenty degrees." Preserve the surrounding text and all figures. The observations are synthetic and confirmed for this sample.`

export const writingExerciseData = 'data/sessions.csv'
export const writingExerciseCommand = '\\undefinedSampleCommand'
export const writingExerciseClaim = 'The mean of the two sample readings was 20 degrees.'
export const writingExerciseSubmission = 'Practice recovery'
export const writingExercisePrompt = `Revise sections/methods.tex and sections/results.tex using ${writingExerciseData}, compile the manuscript, and prepare the submission named "${writingExerciseSubmission}". This synthetic exercise deliberately includes a Results compiler error so the author can practice recovering.`

export function writingSampleArchiveName(goal: string | undefined) {
  if (goal === writingSamplePrompt) return writingSampleSubmission
  if (goal === writingExercisePrompt) return writingExerciseSubmission
}
