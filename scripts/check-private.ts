#!/usr/bin/env bun
// Pre-commit privacy guard. Refuses a commit that would publish personal data:
//   1. any file in the private folder (me/, or $JOB_PILOT_HOME inside the repo), force-added past .gitignore
//   2. resumes, documents or photos (.pdf .doc .docx .odt .rtf .pages .png .jpg .jpeg .heic) outside example/
//   3. your own details from me/answers.md and me/profile.md (name, email, phone, links, companies) anywhere
//   4. any email address or phone number (Indian mobile or +<country code>) that isn't an obvious placeholder
// Run by .githooks/pre-commit (switched on by `bun run jp init`), or by hand:
//   bun run check-private [--all]     (--all scans every tracked file plus new, not-ignored ones)

import { spawnSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import { isAbsolute, join, relative, sep } from "path"
import { meDir, mePath, REPO_ROOT } from "../src/paths.ts"

/** git output as bytes, or null if git failed. */
function git(root: string, ...args: string[]): Buffer | null {
  const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: root, encoding: "buffer", maxBuffer: 1 << 28 })
  return r.status === 0 ? r.stdout : null
}

/** NUL-separated names (-z), so names with spaces or non-ASCII letters come through unquoted. */
function gitNames(root: string, ...args: string[]): string[] {
  const out = git(root, ...args, "-z")
  if (out === null) throw new Error(`git ${args.join(" ")} failed`)
  return out.toString("utf8").split("\0").filter(Boolean)
}

/** Files to check: staged additions and changes, or (--all) every tracked file plus new, not-ignored ones. */
export function listFiles(root: string, all: boolean): string[] {
  if (!all) return gitNames(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR")
  // Tracked files deleted from the working copy have nothing left to leak.
  const tracked = gitNames(root, "ls-files").filter((f) => existsSync(join(root, f)))
  return [...new Set([...tracked, ...gitNames(root, "ls-files", "--others", "--exclude-standard")])]
}

/** What would be committed (the staged copy), or with --all the working copy. Null if it can't be read. */
export function readContent(root: string, f: string, all: boolean): string | null {
  if (all) return existsSync(join(root, f)) ? readFileSync(join(root, f)).toString("utf8") : null
  return git(root, "show", `:${f}`)?.toString("utf8") ?? null
}

const PLACEHOLDER_EMAIL = /@(example\.(com|org|net)|users\.noreply\.github\.com|anthropic\.com)$/i
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// +91 or 0 prefix optional, then a 10-digit mobile starting 6-9 (spaces/dashes allowed)
const MOBILE = /(?<![\d])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d])/g
// Any country: +, a 1-3 digit code, then 8-13 digits (spaces/dashes allowed)
const INTL_PHONE = /(?<![\w+])\+\d{1,3}[\s-]?(?:\d[\s-]?){7,12}\d(?!\d)/g
const DOCUMENT = /\.(pdf|docx?|odt|rtf|pages|png|jpe?g|heic)$/i
const BINARY = /\.(pdf|docx?|odt|rtf|pages|png|jpe?g|heic|gif|ico|woff2?)$/i

/** Runs of zeros or one repeated digit: +91 00000 00000, 99999 99999. */
const placeholderPhone = (m: string) => /0{5}|(\d)\1{6}/.test(m.replace(/\D/g, ""))

export function phoneNumbers(text: string): string[] {
  const found = [...(text.match(MOBILE) ?? []), ...(text.match(INTL_PHONE) ?? [])].map((m) => m.trim())
  return [...new Set(found)].filter((m) => !placeholderPhone(m))
}

// ---------------------------------------------------------------------------
// The user's own values

const ANSWER_LINE = /^-\s*(first name|last name|email|phone|linkedin|github|current company)\s*:\s*(.+)$/i
const PROFILE_LINE = /^-\s*(name|current role|current company|before)\s*:\s*(.+)$/i
/** Words too common to block even if they are someone's value. */
const COMMON = new Set(["india", "remote", "none", "n/a", "self", "self-employed", "freelance", "student", "startup", "engineer", "software"])

/** Hard values block wherever they appear; soft ones (single names, companies) only where a change adds them. */
export interface Secrets {
  hard: string[]
  soft: string[]
}

function fields(path: string, re: RegExp): [string, string][] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim().match(re))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [m[1].toLowerCase(), m[2].trim()])
}

/** The company in "Software Engineer II at Acme Payments (fictional), since 2023". */
const companyOf = (role: string) => role.match(/\bat\s+([^(,;]+)/i)?.[1]?.trim() ?? ""

export function secretsFrom(answersPath: string, profilePath: string): Secrets {
  const hard: string[] = []
  const soft: string[] = []
  const a = fields(answersPath, ANSWER_LINE)
  const get = (k: string) => a.find(([key]) => key === k)?.[1] ?? ""
  for (const [k, v] of a) (["first name", "last name", "current company"].includes(k) ? soft : hard).push(v)
  if (get("first name") && get("last name")) hard.push(`${get("first name")} ${get("last name")}`)
  for (const [k, v] of fields(profilePath, PROFILE_LINE)) {
    if (k === "name") {
      hard.push(v)
      soft.push(...v.split(/\s+/).filter((w) => w.length >= 4))
    } else if (k === "current company") soft.push(v)
    else soft.push(companyOf(v))
  }
  return { hard: [...new Set(hard)], soft: [...new Set(soft.filter(Boolean))] }
}

/** The user's values, minus the fake ones from example/ (a fresh `jp init`) and obvious placeholders. */
export function personalValues(root = REPO_ROOT): Secrets {
  const fake = secretsFrom(join(root, "example", "answers.md"), join(root, "example", "profile.md"))
  const fakeSet = new Set([...fake.hard, ...fake.soft].map((v) => v.toLowerCase()))
  const mine = secretsFrom(mePath("answers.md"), mePath("profile.md"))
  const keep = (min: number) => (v: string) =>
    v.length >= min && !fakeSet.has(v.toLowerCase()) && !COMMON.has(v.toLowerCase()) && !PLACEHOLDER_EMAIL.test(v) && !/example|0000/.test(v)
  return { hard: mine.hard.filter(keep(3)), soft: mine.soft.filter(keep(4)) }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Whole-word, case-insensitive: a name like "Ravi" shouldn't match "Ravine". */
const occurrences = (text: string, v: string) => (text.match(new RegExp(`(?<![\\w])${escape(v)}(?![\\w])`, "gi")) ?? []).length

// ---------------------------------------------------------------------------
// Checks

/** Folders that hold personal data, relative to the repo, "/"-separated. */
export function privateDirs(root = REPO_ROOT): string[] {
  const rel = relative(root, meDir()).split(sep).join("/")
  const inside = rel && !rel.startsWith("..") && !isAbsolute(rel)
  return inside && rel !== "me" ? ["me", rel] : ["me"]
}

export function pathProblem(f: string, priv: string[]): string | null {
  if (priv.some((d) => f === d || f.startsWith(`${d}/`))) return `${f}: files in ${priv.map((d) => `${d}/`).join(" or ")} are personal and never committed`
  if (DOCUMENT.test(f) && !f.startsWith("example/")) return `${f}: resumes, documents and photos belong in me/ (only example/ may hold a fake one)`
  return null
}

/** This file names its own patterns; those lines are not data. */
const GUARD = "scripts/check-private.ts"
const PATTERN_LINE = /^const [A-Z_]+ = \/.*\/[a-z]*$/

export function textProblems(f: string, text: string, secrets: Secrets, before = ""): string[] {
  if (f === GUARD) text = text.split("\n").filter((l) => !PATTERN_LINE.test(l.trim())).join("\n")
  const out: string[] = []
  for (const v of secrets.hard) if (occurrences(text, v)) out.push(`${f}: contains your "${v}" from me/`)
  for (const v of secrets.soft) if (occurrences(text, v) > occurrences(before, v)) out.push(`${f}: adds your "${v}" from me/`)
  for (const m of text.match(EMAIL) ?? []) if (!PLACEHOLDER_EMAIL.test(m)) out.push(`${f}: email address ${m}`)
  for (const m of phoneNumbers(text)) out.push(`${f}: phone number ${m}`)
  return out
}

export function scan(root: string, all: boolean, secrets: Secrets, priv: string[]): { files: number; problems: string[] } {
  const files = listFiles(root, all)
  const problems: string[] = []
  for (const f of files) {
    const p = pathProblem(f, priv)
    if (p) {
      problems.push(p)
      continue
    }
    if (BINARY.test(f)) continue
    const text = readContent(root, f, all)
    if (text === null) {
      problems.push(`${f}: could not read its ${all ? "contents" : "staged contents"}, so it can't be checked`)
      continue
    }
    // Soft values already in the last commit are not new leaks (a company the code names, say).
    const before = secrets.soft.length ? git(root, "show", `HEAD:${f}`)?.toString("utf8") ?? "" : ""
    problems.push(...textProblems(f, text, secrets, before))
  }
  return { files: files.length, problems: [...new Set(problems)] }
}

if (import.meta.main) {
  const all = process.argv.includes("--all")
  let result
  try {
    result = scan(REPO_ROOT, all, personalValues(), privateDirs())
  } catch (e) {
    process.stderr.write(`Privacy check could not run: ${(e as Error).message}\n`)
    process.exit(1)
  }
  if (result.problems.length) {
    process.stderr.write(
      "Commit blocked: it would publish personal data.\n" +
        result.problems.map((p) => `  - ${p}`).join("\n") +
        "\nUse placeholders (name@example.com, +91 00000 00000) or move the file to me/.\n"
    )
    process.exit(1)
  }
  if (all) process.stdout.write(`No personal data found in ${result.files} files (tracked and new).\n`)
}
