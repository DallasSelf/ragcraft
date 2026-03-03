#!/usr/bin/env node
const path = require('path')
const fs = require('fs')
const net = require('net')
const { spawn } = require('child_process')

const DEFAULT_SERVER_DIR = 'C:/Users/dalla/Desktop/School/RAGCraft/mc/paper'
const DEFAULT_SERVER_JAR = 'paper-1.21.8.jar'

function parseArgs() {
  const args = {
    scenario: 'lever',
    repeats: 1,
    delay: 1500,
    mode: 'distilled',
    serverHost: 'localhost',
    serverPort: 25565,
    serverDir: DEFAULT_SERVER_DIR,
    serverJar: DEFAULT_SERVER_JAR,
    javaPath: 'java',
    minMemory: '4G',
    maxMemory: '4G',
    serverTimeout: 180,
    useRunJs: false,
    skipServerStart: false,
    stopServerWhenDone: false,
    runCommand: null
  }

  const raw = process.argv.slice(2)
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = raw[i + 1]
    const consumeValue = () => {
      if (next && !next.startsWith('--')) {
        i += 1
        return next
      }
      return null
    }

    switch (key) {
      case 'scenario':
        args.scenario = consumeValue() || args.scenario
        break
      case 'repeats':
        args.repeats = Number(consumeValue()) || args.repeats
        break
      case 'delay':
        args.delay = Number(consumeValue()) || args.delay
        break
      case 'mode':
        args.mode = consumeValue() || args.mode
        break
      case 'serverDir':
        args.serverDir = consumeValue() || args.serverDir
        break
      case 'serverJar':
        args.serverJar = consumeValue() || args.serverJar
        break
      case 'serverPort':
        args.serverPort = Number(consumeValue()) || args.serverPort
        break
      case 'serverTimeout':
        args.serverTimeout = Number(consumeValue()) || args.serverTimeout
        break
      case 'javaPath':
        args.javaPath = consumeValue() || args.javaPath
        break
      case 'minMemory':
        args.minMemory = consumeValue() || args.minMemory
        break
      case 'maxMemory':
        args.maxMemory = consumeValue() || args.maxMemory
        break
      case 'runCommand':
        args.runCommand = consumeValue() || args.runCommand
        break
      case 'useRunJs':
        args.useRunJs = true
        break
      case 'skipServerStart':
        args.skipServerStart = true
        break
      case 'stopServerWhenDone':
        args.stopServerWhenDone = true
        break
      default:
        console.warn(`Unknown option --${key} (ignored)`) // eslint-disable-line no-console
    }
  }

  return args
}

function waitForPort(host, port, timeoutSeconds) {
  const timeoutMs = timeoutSeconds * 1000
  return new Promise(resolve => {
    const start = Date.now()
    function attempt() {
      const socket = net.createConnection(port, host)
      let settled = false
      socket.once('connect', () => {
        settled = true
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        if (settled) return
        if (Date.now() - start >= timeoutMs) {
          resolve(false)
        } else {
          setTimeout(attempt, 1500)
        }
      })
    }
    attempt()
  })
}

function spawnServerProcess(args) {
  const jarPath = path.resolve(args.serverDir, args.serverJar)
  if (!fs.existsSync(jarPath)) {
    throw new Error(`Server jar not found: ${jarPath}`)
  }

  const javaArgs = [`-Xms${args.minMemory}`, `-Xmx${args.maxMemory}`, '-jar', jarPath, 'nogui']
  const child = spawn(args.javaPath, javaArgs, {
    cwd: args.serverDir,
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: false
  })

  child.on('exit', code => {
    if (code !== null) {
      console.log(`[server] exited with code ${code}`) // eslint-disable-line no-console
    }
  })

  child.on('error', err => {
    console.error('[server] failed to start:', err.message) // eslint-disable-line no-console
  })

  return child
}

function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: 'inherit'
    })

    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with exit code ${code}`))
      }
    })

    child.on('error', err => {
      reject(err)
    })
  })
}

async function stopServer(child) {
  if (!child || child.killed) return
  try {
    child.stdin.write('stop\n')
  } catch (err) {
    console.warn('Unable to send stop command to server:', err.message) // eslint-disable-line no-console
  }
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      if (child.kill()) {
        console.warn('Server did not stop in time; process killed.') // eslint-disable-line no-console
      }
      resolve()
    }, 15000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function main() {
  const args = parseArgs()
  const repoRoot = __dirname

  if (!args.runCommand) {
    if (args.useRunJs) {
      args.runCommand = `node run.js ${args.scenario} --mode ${args.mode}`
    } else {
      args.runCommand = `node runScenarios.js --scenario ${args.scenario} --repeats ${args.repeats} --delay ${args.delay}`
    }
  }

  let serverProcess = null
  if (!args.skipServerStart) {
    console.log(`Starting Paper server from ${args.serverDir} (jar ${args.serverJar}) ...`)
    serverProcess = spawnServerProcess(args)
    console.log('Waiting for server port ...')
    const ready = await waitForPort(args.serverHost, args.serverPort, args.serverTimeout)
    if (!ready) {
      throw new Error(`Server did not open port ${args.serverPort} within ${args.serverTimeout}s`)
    }
    console.log('Server port is open. Running scenario command...')
  } else {
    console.log('Skipping server startup (assuming it is already running).')
  }

  try {
    await runCommand(args.runCommand, repoRoot)
  } finally {
    if (serverProcess && args.stopServerWhenDone) {
      console.log('Stopping Paper server...')
      await stopServer(serverProcess)
    }
  }
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
