import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-4xl font-semibold tracking-tight">Research Canvas</h1>
      <p className="text-muted-foreground">
        Organize paper sections on a canvas, preview LaTeX, and export your manuscript.
      </p>
      <nav aria-label="Workspaces" className="flex flex-wrap items-center gap-5">
        <Link href="/research" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          Open research canvas
        </Link>
        <Link href="/research-dev" className="underline">Sample paper</Link>
        <Link href="/codeblock" className="underline">Code block demo</Link>
      </nav>
    </main>
  );
}
