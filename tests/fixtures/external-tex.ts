import { execFileSync } from 'node:child_process'

export function externalTexCommand(command: string, args: string[], cwd: string) {
  const distro = process.env.RESEARCH_BIBER_WSL
  const options = { encoding: 'utf8' as const, timeout: 60_000 }
  if (!distro) return execFileSync(command, args, { ...options, cwd })
  const directory = execFileSync('wsl.exe', ['-d', distro, '--', 'wslpath', '-a', cwd.replaceAll('\\', '/')], options).trim()
  return execFileSync('wsl.exe', ['-d', distro, '--cd', directory, '--', command, ...args], options)
}
