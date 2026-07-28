import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const HISTORICAL_PWA_RELEASES = [
  {
    commit: '4c8f60ec93d2029e6b13b89b27a3b8855d8bf847',
    expectedPackageLockObject: '24cbd3334a6daf03437654edde662c8f7ad486b0',
    expectedTree: '63f07dc6b1978b2b152144ee74d4a4e2bc45d139',
    label: 'limited-beta-closeout',
  },
  {
    commit: '4c7489352f0d8ddb6195c1b61727a9a845fbbd4a',
    expectedPackageLockObject: 'e6a9dbd786dccb50ad00964c2e21d54cbd69e38b',
    expectedTree: 'ef2617f98f0a4c87340250f6215f9fb54122f8cf',
    label: 'pwa-precache-budget',
  },
] as const

export type PreparedHistoricalPwaRelease = {
  commit: string
  distDir: string
  label: string
  version: string
}

export async function buildHistoricalPwaReleases(
  tempDir: string,
): Promise<PreparedHistoricalPwaRelease[]> {
  const workspaceRoot = process.cwd()
  const currentNodeModules = join(workspaceRoot, 'node_modules')
  await access(currentNodeModules)
  const currentPackageLockObject = await runCommand(
    'git',
    ['hash-object', 'package-lock.json'],
    { cwd: workspaceRoot },
  )
  const releases: PreparedHistoricalPwaRelease[] = []

  for (const release of HISTORICAL_PWA_RELEASES) {
    await assertHistoricalRelease(workspaceRoot, release)
    const sourceDir = join(tempDir, `source-${release.label}`)
    const archivePath = join(tempDir, `${release.label}.tar`)
    await mkdir(sourceDir, { recursive: true })
    await runCommand(
      'git',
      ['archive', '--format=tar', `--output=${archivePath}`, release.commit],
      { cwd: workspaceRoot },
    )
    await runCommand('tar', ['-xf', archivePath, '-C', sourceDir], { cwd: workspaceRoot })
    await rm(archivePath, { force: true })

    const nodeModulesDir = release.expectedPackageLockObject === currentPackageLockObject
      ? currentNodeModules
      : await prepareHistoricalNodeModules({
          packageLockObject: release.expectedPackageLockObject,
          sourceDir,
          workspaceRoot,
        })
    await symlink(nodeModulesDir, join(sourceDir, 'node_modules'), 'dir')

    await runCommand(
      join(sourceDir, 'node_modules', '.bin', viteExecutable()),
      ['build'],
      {
        cwd: sourceDir,
        env: {
          ...safeChildEnvironment(),
          CF_PAGES_COMMIT_SHA: release.commit,
          NODE_ENV: 'production',
          VITE_E2E_AUTH_BYPASS: '1',
        },
        timeoutMs: 120_000,
      },
    )
    const distDir = join(sourceDir, 'dist')
    await Promise.all([
      access(join(distDir, 'index.html')),
      access(join(distDir, 'sw.js')),
      access(join(distDir, 'manifest.webmanifest')),
    ])
    releases.push({
      commit: release.commit,
      distDir,
      label: release.label,
      version: release.commit.slice(0, 8),
    })
  }

  return releases
}

async function prepareHistoricalNodeModules(input: {
  packageLockObject: string
  sourceDir: string
  workspaceRoot: string
}) {
  const cacheDir = join(
    input.workspaceRoot,
    'node_modules',
    '.cache',
    'tripmap-pwa-history',
    input.packageLockObject,
  )
  const markerPath = join(cacheDir, '.tripmap-pwa-history-lock')
  const nodeModulesDir = join(cacheDir, 'node_modules')
  try {
    const marker = (await readFile(markerPath, 'utf8')).trim()
    if (marker === input.packageLockObject) {
      await access(nodeModulesDir)
      return nodeModulesDir
    }
  } catch {
    // Missing or incomplete cache entries are rebuilt from the pinned lockfile.
  }

  await rm(cacheDir, { force: true, recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await Promise.all([
    copyFile(join(input.sourceDir, '.npmrc'), join(cacheDir, '.npmrc')),
    copyFile(join(input.sourceDir, 'package.json'), join(cacheDir, 'package.json')),
    copyFile(join(input.sourceDir, 'package-lock.json'), join(cacheDir, 'package-lock.json')),
  ])
  await runCommand(
    npmExecutable(),
    ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'],
    {
      cwd: cacheDir,
      env: safeChildEnvironment(),
      timeoutMs: 120_000,
    },
  )
  await writeFile(markerPath, `${input.packageLockObject}\n`, 'utf8')
  return nodeModulesDir
}

async function assertHistoricalRelease(
  workspaceRoot: string,
  release: (typeof HISTORICAL_PWA_RELEASES)[number],
) {
  const commit = await runCommand(
    'git',
    ['rev-parse', `${release.commit}^{commit}`],
    { cwd: workspaceRoot },
  )
  if (commit !== release.commit) {
    throw new Error(`historical PWA commit mismatch for ${release.label}`)
  }
  const tree = await runCommand(
    'git',
    ['rev-parse', `${release.commit}^{tree}`],
    { cwd: workspaceRoot },
  )
  if (tree !== release.expectedTree) {
    throw new Error(`historical PWA tree mismatch for ${release.label}`)
  }
  const packageLockObject = await runCommand(
    'git',
    ['rev-parse', `${release.commit}:package-lock.json`],
    { cwd: workspaceRoot },
  )
  if (packageLockObject !== release.expectedPackageLockObject) {
    throw new Error(`historical PWA lockfile mismatch for ${release.label}`)
  }
  await runCommand(
    'git',
    ['merge-base', '--is-ancestor', release.commit, 'HEAD'],
    { cwd: workspaceRoot },
  )
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
  },
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
      rejectCommand(new Error(`${command} timed out while preparing historical PWA builds`))
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

function appendBoundedOutput(current: string, next: string) {
  const combined = current + next
  return combined.length > 20_000 ? combined.slice(-20_000) : combined
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

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function viteExecutable() {
  return process.platform === 'win32' ? 'vite.cmd' : 'vite'
}
