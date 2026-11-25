// Stands in for the `claude` CLI: every message is one Artifact call, asked of the permission hook first as the real one does.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

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
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const filesOf = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(remote, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))

async function allowed(input) {
  try {
    const response = await fetch(hook.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...hook.headers },
      body: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Artifact', tool_input: input }),
    })
    if (!response.ok) return false
    return (await response.json()).hookSpecificOutput.permissionDecision === 'allow'
  } catch {
    return false
  }
}

function carryOut(input) {
  if (input.action === 'list') {
    const files = filesOf(remote).map((file) => ({ path: file, sha256: sha256(readFileSync(path.join(remote, file))) }))
    return { data: { file_list: { url: input.url, files } }, text: 'Published files' }
  }
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
  for (const [key, source] of Object.entries(input.files)) writeFileSync(path.join(remote, key), readFileSync(path.resolve(process.cwd(), input.root, source)))
  return { data: { published: true }, text: 'Published' }
}

async function attempt(input) {
  const isAllowed = await allowed(input)
  appendFileSync(path.join(home, 'calls.log'), `${JSON.stringify({ action: input.action, allowed: isAllowed })}\n`)
  const result = isAllowed ? carryOut(input) : { error: 'Permission to use Artifact has been denied' }
  const block = { type: 'tool_result', tool_use_id: 'x', content: result.error ?? [{ type: 'text', text: result.text }], ...(result.error ? { is_error: true } : {}) }
  emit({ type: 'user', message: { role: 'user', content: [block] }, tool_use_result: result.error ?? result.data })
}

emit({ type: 'system', subtype: 'init', tools: ['Artifact'] })
for await (const line of createInterface({ input: process.stdin })) {
  const text = JSON.parse(line).message.content[0].text
  const input = JSON.parse(text.slice(text.indexOf('\n') + 1))
  if (behaviour.crash) process.exit(3)
  if (behaviour.hang) continue
  if (behaviour.apiError) {
    emit({ type: 'result', is_error: true, result: behaviour.apiError })
    continue
  }
  if (behaviour.talkOnly) {
    emit({ type: 'result', is_error: false, result: 'I would rather not' })
    continue
  }
  for (const stray of behaviour.strays ?? []) await attempt({ ...input, ...stray })
  await attempt(input)
  if (behaviour.twice) await attempt(input)
  emit({ type: 'result', is_error: false, result: 'done' })
}
