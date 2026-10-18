// Where personal data lives. Everything a user owns (resume, answers, company
// list, jobs file) sits in one git-ignored folder, `me/` at the repo root by
// default, or $JOB_PILOT_HOME. Code never writes personal data anywhere else.

import { join } from "path"

export const REPO_ROOT = join(import.meta.dir, "..")

export function meDir(): string {
  return process.env.JOB_PILOT_HOME || join(REPO_ROOT, "me")
}

export function mePath(...parts: string[]): string {
  return join(meDir(), ...parts)
}
