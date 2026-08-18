import { existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REMOTE = process.env.DSH_STUDIO_REMOTE ?? 'macmini'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = resolve(root, 'compose.remote.yml')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error !== undefined) fail(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function agentName(value: string | undefined): string {
  if (value === undefined || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value)) {
    fail('Agent name must contain lowercase letters, digits, or hyphens (maximum 32 characters).')
  }
  return value
}

function tcpPort(value: string | undefined, label: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail(`${label} must be a TCP port.`)
  return port
}

function portRange(value: string | undefined): { text: string; start: number; end: number } {
  const match = /^(\d+)-(\d+)$/.exec(value ?? '')
  if (match === null) fail('Preview ports must use start-end syntax, for example 13100-13115.')
  const start = tcpPort(match[1], 'Preview range start')
  const end = tcpPort(match[2], 'Preview range end')
  if (start > end) fail('Preview port range must be ascending.')
  return { text: `${start}-${end}`, start, end }
}

function project(agent: string): string {
  return `dsh-studio-${agent}`
}

function socket(agent: string): string {
  return `/tmp/dsh-studio-${agent}.sock`
}

function dockerCompose(agent: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  run('docker', ['--host', `ssh://${REMOTE}`, 'compose', '-f', composeFile, '-p', project(agent), ...args], env)
}

function stopTunnel(agent: string): void {
  const path = socket(agent)
  if (!existsSync(path)) return
  const result = spawnSync('ssh', ['-S', path, '-O', 'exit', REMOTE], { stdio: 'ignore' })
  if (result.status !== 0 && existsSync(path)) unlinkSync(path)
}

function startTunnel(agent: string, studioPort: number, preview: ReturnType<typeof portRange>): void {
  stopTunnel(agent)
  const forwards = [studioPort, ...Array.from({ length: preview.end - preview.start + 1 }, (_, index) => preview.start + index)]
    .flatMap(port => ['-L', `${port}:127.0.0.1:${port}`])
  run('ssh', [
    '-M', '-S', socket(agent), '-fN',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    ...forwards,
    REMOTE,
  ])
}

const [command, rawAgent, rawStudioPort, rawPreviewRange] = process.argv.slice(2)
if (command === 'check') {
  run('docker', ['--host', `ssh://${REMOTE}`, 'version'])
  process.exit(0)
}
const agent = agentName(rawAgent)

if (command === 'up' || command === 'tunnel') {
  const studioPort = tcpPort(rawStudioPort, 'Studio port')
  const preview = portRange(rawPreviewRange)
  if (studioPort >= preview.start && studioPort <= preview.end) fail('Studio port must be outside the Preview range.')
  if (command === 'up') {
    dockerCompose(agent, ['up', '--detach', '--build'], {
      ...process.env,
      PREVIEW_PORT_RANGE: preview.text,
      STUDIO_PORT: String(studioPort),
    })
  }
  startTunnel(agent, studioPort, preview)
  console.log(`Studio ${agent}: http://127.0.0.1:${studioPort}/studio`)
} else if (command === 'down') {
  stopTunnel(agent)
  dockerCompose(agent, ['down', '--remove-orphans'])
} else if (command === 'logs') {
  dockerCompose(agent, ['logs', '--follow', 'studio'])
} else if (command === 'status') {
  dockerCompose(agent, ['ps'])
} else {
  fail('Usage: npm run remote -- <up|tunnel> <agent> <studio-port> <preview-start>-<preview-end>\n'
    + '       npm run remote -- <down|logs|status> <agent>\n'
    + '       npm run remote -- check')
}
