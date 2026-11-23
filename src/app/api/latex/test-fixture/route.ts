import { testPaperZip } from '@/lib/project/test-paper'
import { isLocalResearchTest } from '@/lib/project/test-mode'

export async function GET(request: Request) {
  if (!isLocalResearchTest(request.headers.get('host'))) return new Response(null, { status: 404 })
  return new Response(await testPaperZip(), { headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="Practice Paper.zip"',
  } })
}
