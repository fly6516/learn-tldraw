export function isLocalResearchTest(host: string | null) {
  return process.env.RESEARCH_TEST_MODE === '1' && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host ?? '')
}
