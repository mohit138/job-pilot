import { spawnSync } from "child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs"
import { join } from "path"
import { meDir, REPO_ROOT } from "../paths.ts"

/**
 * Create the private me/ folder from example/ (never overwriting what is
 * already there) and switch on the git hook that keeps personal files out of
 * commits.
 */
export function runInit(): number {
  const dir = meDir()
  mkdirSync(dir, { recursive: true })
  const created: string[] = []
  const kept: string[] = []
  const exampleDir = join(REPO_ROOT, "example")
  for (const f of readdirSync(exampleDir)) {
    const target = join(dir, f)
    if (existsSync(target)) kept.push(f)
    else {
      copyFileSync(join(exampleDir, f), target)
      created.push(f)
    }
  }
  const hook = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: REPO_ROOT })
  process.stdout.write(
    JSON.stringify(
      {
        me: dir,
        created,
        keptExisting: kept,
        privacyHook: hook.status === 0 ? "on" : "not set (not a git checkout?)",
        next: "Replace me/resume.pdf with your resume, then fill in me/profile.md, me/answers.md and me/search.json (or ask Claude: /setup).",
      },
      null,
      2
    ) + "\n"
  )
  return 0
}
