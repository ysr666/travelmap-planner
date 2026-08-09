import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { access, copyFile, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

export const UI_V3_GOLDEN_BASELINE = {
  commit: '5562097da3ae4bddbdfbd82dcde9124346d07999',
  expectedPackageLockObject: 'e6a9dbd786dccb50ad00964c2e21d54cbd69e38b',
  expectedTree: 'd9069921148f27990dd935786d81ad310eb3c785',
} as const

export type UiV3GoldenServer = {
  close: () => Promise<void>
  origin: string
}

export async function buildUiV3GoldenBaseline(tempDir: string) {
  const workspaceRoot = process.cwd()
  await assertPinnedBaseline(workspaceRoot)

  const sourceDir = join(tempDir, 'source')
  const archivePath = join(tempDir, 'baseline.tar')
  await mkdir(sourceDir, { recursive: true })
  await runCommand('git', [
    'archive',
    '--format=tar',
    `--output=${archivePath}`,
    UI_V3_GOLDEN_BASELINE.commit,
  ], { cwd: workspaceRoot })
  await runCommand('tar', ['-xf', archivePath, '-C', sourceDir], { cwd: workspaceRoot })
  await rm(archivePath, { force: true })

  const nodeModulesDir = await resolveBaselineNodeModules({ sourceDir, workspaceRoot })
  await symlink(nodeModulesDir, join(sourceDir, 'node_modules'), 'dir')
  await runCommand(
    join(sourceDir, 'node_modules', '.bin', viteExecutable()),
    ['build'],
    {
      cwd: sourceDir,
      env: {
        ...safeChildEnvironment(),
        CF_PAGES_COMMIT_SHA: UI_V3_GOLDEN_BASELINE.commit,
        NODE_ENV: 'production',
        VITE_E2E_AUTH_BYPASS: '1',
      },
      timeoutMs: 120_000,
    },
  )

  const distDir = join(sourceDir, 'dist')
  await access(join(distDir, 'index.html'))
  return distDir
}

export async function startUiV3GoldenServer(distDir: string): Promise<UiV3GoldenServer> {
  const normalizedRoot = resolve(distDir)
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      const requestPath = decodeURIComponent(requestUrl.pathname)
      const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1)
      const candidatePath = resolve(normalizedRoot, relativePath)
      const safePrefix = `${normalizedRoot}${sep}`
      if (candidatePath !== normalizedRoot && !candidatePath.startsWith(safePrefix)) {
        response.writeHead(403).end('Forbidden')
        return
      }

      let body: Buffer
      let servedPath = candidatePath
      try {
        body = await readFile(candidatePath)
      } catch {
        servedPath = join(normalizedRoot, 'index.html')
        body = await readFile(servedPath)
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentTypeFor(servedPath),
      })
      response.end(body)
    } catch {
      response.writeHead(500).end('Golden baseline server error')
    }
  })

  await new Promise<void>((resolveServer, rejectServer) => {
    server.once('error', rejectServer)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectServer)
      resolveServer()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('UI V3 golden baseline server did not expose a TCP port')
  }

  return {
    close: () => closeServer(server),
    origin: `http://127.0.0.1:${address.port}`,
  }
}

async function assertPinnedBaseline(workspaceRoot: string) {
  const commit = await runCommand('git', ['rev-parse', `${UI_V3_GOLDEN_BASELINE.commit}^{commit}`], {
    cwd: workspaceRoot,
  })
  const tree = await runCommand('git', ['rev-parse', `${UI_V3_GOLDEN_BASELINE.commit}^{tree}`], {
    cwd: workspaceRoot,
  })
  const packageLockObject = await runCommand(
    'git',
    ['rev-parse', `${UI_V3_GOLDEN_BASELINE.commit}:package-lock.json`],
    { cwd: workspaceRoot },
  )

  if (commit !== UI_V3_GOLDEN_BASELINE.commit) throw new Error('UI V3 golden commit mismatch')
  if (tree !== UI_V3_GOLDEN_BASELINE.expectedTree) throw new Error('UI V3 golden tree mismatch')
  if (packageLockObject !== UI_V3_GOLDEN_BASELINE.expectedPackageLockObject) {
    throw new Error('UI V3 golden lockfile mismatch')
  }
}

async function resolveBaselineNodeModules(input: { sourceDir: string; workspaceRoot: string }) {
  const currentNodeModules = join(input.workspaceRoot, 'node_modules')
  await access(currentNodeModules)
  const currentPackageLockObject = await runCommand('git', ['hash-object', 'package-lock.json'], {
    cwd: input.workspaceRoot,
  })
  if (currentPackageLockObject === UI_V3_GOLDEN_BASELINE.expectedPackageLockObject) {
    return currentNodeModules
  }

  const cacheDir = join(
    currentNodeModules,
    '.cache',
    'tripmap-ui-v3-golden',
    UI_V3_GOLDEN_BASELINE.expectedPackageLockObject,
  )
  const markerPath = join(cacheDir, '.lock-object')
  const cachedNodeModules = join(cacheDir, 'node_modules')
  try {
    if ((await readFile(markerPath, 'utf8')).trim() === UI_V3_GOLDEN_BASELINE.expectedPackageLockObject) {
      await access(cachedNodeModules)
      return cachedNodeModules
    }
  } catch {
    // A missing or partial cache is rebuilt from the pinned lockfile.
  }

  await rm(cacheDir, { force: true, recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await Promise.all([
    copyFile(join(input.sourceDir, '.npmrc'), join(cacheDir, '.npmrc')),
    copyFile(join(input.sourceDir, 'package.json'), join(cacheDir, 'package.json')),
    copyFile(join(input.sourceDir, 'package-lock.json'), join(cacheDir, 'package-lock.json')),
  ])
  await runCommand(npmExecutable(), [
    'ci',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--prefer-offline',
  ], {
    cwd: cacheDir,
    env: safeChildEnvironment(),
    timeoutMs: 120_000,
  })
  await writeFile(markerPath, `${UI_V3_GOLDEN_BASELINE.expectedPackageLockObject}\n`, 'utf8')
  return cachedNodeModules
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) {
  return new Promise<string>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? safeChildEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      rejectCommand(new Error(`${command} timed out while preparing the UI V3 golden baseline`))
    }, options.timeoutMs ?? 30_000)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendBoundedOutput(stdout, chunk.toString())
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendBoundedOutput(stderr, chunk.toString())
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      rejectCommand(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolveCommand(stdout.trim())
        return
      }
      const detail = stderr.trim() || stdout.trim() || `signal ${signal ?? 'unknown'}`
      rejectCommand(new Error(`${command} failed (${code ?? 'no exit code'}): ${detail}`))
    })
  })
}

function closeServer(server: Server) {
  return new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}

function contentTypeFor(filePath: string) {
  switch (extname(filePath)) {
    case '.css': return 'text/css; charset=utf-8'
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.png': return 'image/png'
    case '.svg': return 'image/svg+xml'
    case '.webmanifest': return 'application/manifest+json'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const keys = [
    'ALL_PROXY',
    'CI',
    'HOME',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'PATH',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'npm_config_cache',
  ] as const
  return Object.fromEntries(
    keys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]),
  )
}

function appendBoundedOutput(current: string, next: string) {
  const combined = current + next
  return combined.length > 20_000 ? combined.slice(-20_000) : combined
}

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function viteExecutable() {
  return process.platform === 'win32' ? 'vite.cmd' : 'vite'
}
