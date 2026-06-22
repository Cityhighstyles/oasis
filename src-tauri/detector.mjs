#!/usr/bin/env node

/**
 * detector.mjs — Real-time process monitor using systeminformation.
 *
 * Spawned by the Tauri Rust backend as a sidecar process.
 * Polls the process table every 500ms via `si.processes()` and outputs
 * newly-detected developer operations as JSON lines to stdout.
 *
 * The Rust backend reads stdout, parses each JSON line, and creates
 * DetectedOperation entries in the sandbox engine.
 *
 * Output format (one JSON object per line):
 *   {"pid":1234,"exe":"node.exe","cmd":"node npm-cli.js install react-icons","type":"npm install","exePath":"C:\\Program Files\\nodejs\\node.exe"}
 *
 * Supported operations:
 *   npm install, pnpm install, yarn install, npx run,
 *   docker pull/build/compose, git clone/pull/fetch,
 *   pip install, cargo install/build/test, winget/choco/scoop install,
 *   brew install, apt-get install, dotnet restore/build,
 *   go mod download/install/build, mvn/gradle build,
 *   VS Code extension install, Android Studio download
 */

import si from 'systeminformation';

// ── Constants ──────────────────────────────────────────────────────────────

const POLL_MS = 500;

// Set of "pid|cmd" strings to avoid duplicate detections.
const seen = new Set();

// Map of supported executable names (lowercase) to their command types
const SINGLE_PURPOSE = {
  'npm.exe':     'npm install',
  'npm':         'npm install',
  'pnpm.exe':    'pnpm install',
  'pnpm':        'pnpm install',
  'yarn.exe':    'yarn install',
  'yarn':        'yarn install',
  'npx.exe':     'npx run',
  'npx':         'npx run',
  'pip.exe':     'pip install',
  'pip':         'pip install',
  'pip3.exe':    'pip install',
  'pip3':        'pip install',
  'pipenv.exe':  'pipenv install',
  'pipenv':      'pipenv install',
  'poetry.exe':  'poetry install',
  'poetry':      'poetry install',
  'winget.exe':  'winget install',
  'winget':      'winget install',
  'choco.exe':   'choco install',
  'chocolatey.exe': 'choco install',
  'scoop.exe':   'scoop install',
  'scoop':       'scoop install',
  'brew.exe':    'brew install',
  'brew':        'brew install',
  'apt.exe':     'apt-get install',
  'apt-get.exe': 'apt-get install',
  'nuget.exe':   'nuget install',
  'nuget':       'nuget install',
  'rustc.exe':   'cargo build',
  'rustc':       'cargo build',
  'studio64.exe': 'Android Studio Download',
  'studio64':    'Android Studio Download',
  'androidstudio.exe': 'Android Studio Download',
  'androidstudio': 'Android Studio Download',
};

// Multi-purpose tools that need cmdline inspection
const MULTI_PURPOSE = [
  { names: ['node.exe', 'node'], classify: classifyNode },
  { names: ['docker.exe', 'docker'], classify: classifyDocker },
  { names: ['git.exe', 'git'], classify: classifyGit },
  { names: ['code.exe', 'code'], classify: classifyVSCode },
  { names: ['cargo.exe', 'cargo'], classify: classifyCargo },
  { names: ['dotnet.exe', 'dotnet'], classify: classifyDotnet },
  { names: ['go.exe', 'go'], classify: classifyGo },
  { names: ['mvn.exe', 'mvn', 'mvnw.bat', 'mvnw'], classify: () => 'maven build' },
  { names: ['gradle.exe', 'gradle', 'gradlew.bat', 'gradlew'], classify: () => 'Gradle build' },
];

// ── Classification functions ─────────────────────────────────────────────

function classifyNode(name, cmd) {
  const lower = cmd.toLowerCase();
  // Check for pnpm
  if (lower.includes('pnpm')) {
    if (lower.includes('install') || lower.includes(' add ') || lower.includes(' i ')) {
      return 'pnpm install';
    }
    return null;
  }
  // Check for yarn
  if (lower.includes('yarn')) {
    if (lower.includes('install') || lower.includes(' add ')) {
      return 'yarn install';
    }
    return null;
  }
  // Check for npx
  if (lower.includes('npx')) {
    return 'npx run';
  }
  // Check for npm
  if (lower.includes('npm')) {
    if (lower.includes('install') || lower.includes(' i ') || lower.includes(' add ') || lower.includes('ci') || lower.includes('-cli')) {
      return 'npm install';
    }
    return null;
  }
  return null;
}

function classifyDocker(name, cmd) {
  const lower = cmd.toLowerCase();
  if (lower.includes('pull') && !lower.includes('push')) return 'docker pull';
  if (lower.includes('compose build') || (lower.includes('build') && !lower.includes('compose'))) return 'docker build';
  if (lower.includes('compose') && !lower.includes('build')) return 'docker compose';
  if (lower.includes('pull')) return 'docker pull';
  return null;
}

function classifyGit(name, cmd) {
  const lower = cmd.toLowerCase();
  if (lower.includes('clone')) return 'git clone';
  if (lower.includes('pull')) return 'git pull';
  if (lower.includes('fetch')) return 'git fetch';
  return null;
}

function classifyVSCode(name, cmd) {
  const lower = cmd.toLowerCase();
  if (lower.includes('--install-extension')) return 'VS Code Extension Install';
  if (lower.includes('--update-extensions')) return 'VS Code Extension Update';
  return null;
}

function classifyCargo(name, cmd) {
  const lower = cmd.toLowerCase();
  if (lower.includes('install')) return 'cargo install';
  if (lower.includes('build') || lower.includes(' b ')) return 'cargo build';
  if (lower.includes('test') || lower.includes(' t ')) return 'cargo test';
  return null;
}

function classifyDotnet(name, cmd) {
  const lower = cmd.toLowerCase();
  if (lower.includes('restore')) return 'dotnet restore';
  if (lower.includes('build')) return 'dotnet build';
  return null;
}

function classifyGo(name, cmd) {
  const lower = cmd.toLowerCase();
  if (lower.includes('mod download') || lower.includes('mod tidy')) return 'go mod download';
  if (lower.includes('install')) return 'go install';
  if (lower.includes('build') || lower.includes('run')) return 'go build';
  return null;
}

// ── Main detection function ───────────────────────────────────────────────

function detectOperation(proc) {
  const exe = (proc.name || '').toLowerCase();
  const cmd = (proc.command || '');
  const dedupKey = `${proc.pid}|${cmd}`;

  // Skip if already seen
  if (seen.has(dedupKey)) return null;

  // Phase 1: Single-purpose exe-name match
  const singleType = SINGLE_PURPOSE[exe];
  if (singleType) {
    seen.add(dedupKey);
    return singleType;
  }

  // Phase 2: Multi-purpose tools with cmdline inspection
  for (const tool of MULTI_PURPOSE) {
    if (tool.names.includes(exe)) {
      const type = tool.classify(exe, cmd);
      if (type) {
        seen.add(dedupKey);
        return type;
      }
      return null;
    }
  }

  return null;
}

// ── Output helper ─────────────────────────────────────────────────────────

function output(proc, type) {
  const entry = {
    pid: proc.pid,
    exe: proc.name || '',
    cmd: proc.command || '',
    type: type,
    exePath: proc.path || '',
  };
  // Write as JSON line — must be atomic to avoid interleaving
  process.stdout.write(JSON.stringify(entry) + '\n');
}

// ── Poll loop ─────────────────────────────────────────────────────────────

async function poll() {
  while (true) {
    try {
      const data = await si.processes();
      const list = data.list || [];

      for (const proc of list) {
        // Skip system processes (PID 0-4)
        if (proc.pid <= 4) continue;

        // Skip processes with no name
        if (!proc.name) continue;

        const type = detectOperation(proc);
        if (type) {
          output(proc, type);
        }
      }

      // Periodically prune the seen set to prevent unbounded memory growth
      // (keep at most 10000 entries — developer sessions rarely exceed this)
      if (seen.size > 10000) {
        seen.clear();
      }
    } catch (err) {
      // Log to stderr — Rust reads stdout only
      process.stderr.write(`Error: ${err.message}\n`);
    }

    // Sleep between polls (check every 100ms for faster shutdown)
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

// ── Start ─────────────────────────────────────────────────────────────────

poll().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
