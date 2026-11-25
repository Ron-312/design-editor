// Stands in for the `claude` CLI: it makes the calls its hooks tell it to, asking before each one as the real one does.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'

const home = process.env.FAKE_CLAUDE_HOME
const behaviour = existsSync(path.join(home, 'behaviour.json')) ? JSON.parse(readFileSync(path.join(home, 'behaviour.json'), 'utf8')) : {}
const remote = path.join(home, 'remote')
const args = process.argv.slice(2)

if (args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: !behaviour.signedOut }, null, 2))
  process.exit(behaviour.signedOut ? 1 : 0)
}

writeFileSync(path.join(home, 'args.json'), JSON.stringify({ args, cwd: process.cwd(), env: Object.keys(process.env) }))
const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'))
const hook = settings.hooks.PreToolUse[0].hooks[0]
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const filesOf = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(remote, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))

async function hookReply(event) {
  try {
    const response = await fetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json', ...hook.headers }, body: JSON.stringify(event) })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

async function allowed(tool, input) {
  const reply = await hookReply({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input })
  return reply?.hookSpecificOutput?.permissionDecision === 'allow'
}

function carryOut(input) {
  if (input.action === 'list') {
    const files = filesOf(remote).map((file) => ({ path: file, sha256: sha256(readFileSync(path.join(remote, file))) }))
    return { data: { file_list: { url: input.url, files } }, text: 'Published files' }
  }
  if (input.action === 'read' && !input.paths) return { data: { read: { code: 200, result: 'the canvas' } } }
  if (input.action === 'read') {
    const saved = mkdtempSync(path.join(home, 'saved-'))
    const wanted = behaviour.partialRead ? input.paths.slice(1) : input.paths
    const files = wanted.map((file) => {
      const target = path.join(saved, file)
      mkdirSync(path.dirname(target), { recursive: true })
      const asset = path.join(home, 'assets')
      const source = existsSync(path.join(remote, file)) ? path.join(remote, file) : path.join(asset, readdirSync(asset).find((name) => name.startsWith(file)))
      const landing = existsSync(path.join(remote, file)) ? target : path.join(saved, path.basename(source))
      cpSync(source, landing)
      return { path: file, saved_to: landing }
    })
    return { data: { files_read: { title: 'Throwaway', saved_dir: saved, files } }, text: 'Files saved' }
  }
  appendFileSync(path.join(home, 'publishes.log'), `${JSON.stringify(input)}\n`)
  if (behaviour.refusePublish) return { error: 'Error: the live version changed since you read it' }
  if (behaviour.dropPublish) return { data: { published: true }, text: 'Published' }
  const root = path.resolve(process.cwd(), input.root)
  const sent = { [path.relative(realpathSync.native(root), realpathSync.native(input.file_path)).split(path.sep).join('/')]: input.file_path, ...input.files }
  for (const [key, source] of Object.entries(sent)) writeFileSync(path.join(remote, key), readFileSync(path.resolve(root, source)))
  return { data: { published: true }, text: 'Published' }
}

/** The text Claude is given after the call, or null when it was denied. */
async function attempt(input) {
  const isAllowed = await allowed('Artifact', input)
  appendFileSync(path.join(home, 'calls.log'), `${JSON.stringify({ action: input.action, allowed: isAllowed })}\n`)
  if (!isAllowed) return null
  const result = carryOut(input)
  const event = { hook_event_name: result.error ? 'PostToolUseFailure' : 'PostToolUse', tool_name: 'Artifact', tool_input: input }
  const reply = await hookReply({ ...event, ...(result.error ? { error: result.error } : { tool_response: result.data }) })
  return reply?.hookSpecificOutput?.additionalContext ?? null
}

async function readFirst(text) {
  const files = /with the Read tool: (\[.*?\]) and then/.exec(text)
  for (const file of files ? JSON.parse(files[1]) : []) {
    const isAllowed = await allowed('Read', { file_path: file })
    appendFileSync(path.join(home, 'reads.log'), `${JSON.stringify({ file, allowed: isAllowed })}\n`)
  }
}

const stayOpen = () => new Promise(() => setInterval(() => {}, 1_000))

async function finish() {
  const reply = await hookReply({ hook_event_name: 'Stop', last_assistant_message: 'I would rather not' })
  return reply?.decision === 'block' ? reply.reason : null
}

const url = /url (\S+) and nothing else/.exec(args.at(-1))[1]
let instruction = `exactly this input: ${JSON.stringify({ action: 'read', url })}`
if (behaviour.crash) process.exit(3)
if (behaviour.hang) await stayOpen()
for (;;) {
  const input = /exactly this input: (\{.*\})$/.exec(instruction)
  if (!input || behaviour.talkOnly) {
    instruction = await finish()
    if (!instruction) await stayOpen()
    continue
  }
  const call = JSON.parse(input[1])
  await readFirst(instruction)
  for (const stray of behaviour.strays ?? []) await attempt({ ...call, ...stray })
  const told = await attempt(call)
  if (behaviour.twice && call.action === 'publish') await attempt(call)
  instruction = told ?? (await finish()) ?? (await stayOpen())
}
