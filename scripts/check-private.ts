#!/usr/bin/env bun
// Pre-commit privacy guard. Refuses a commit that would publish personal data:
//   1. any file under me/ (force-added past .gitignore)
//   2. resumes or documents (.pdf, .doc, .docx) outside example/
//   3. your own details from me/answers.md (name, email, phone) anywhere
//   4. any email address or Indian mobile number that isn't an obvious placeholder
// Run by .githooks/pre-commit (switched on by `bun run jp init`), or by hand:
//   bun run check-private [--all]     (--all scans every tracked file)

import { spawnSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { mePath, REPO_ROOT } from "../src/paths.ts"

const git = (...args: string[]) => spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).stdout ?? ""

const all = process.argv.includes("--all")
const files = (all ? git("ls-files") : git("diff", "--cached", "--name-only", "--diff-filter=ACMR"))
  .split("\n")
  .filter(Boolean)

const PLACEHOLDER_EMAIL = /@(example\.(com|org|net)|users\.noreply\.github\.com|anthropic\.com)$/i
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// +91 or 0 prefix optional, then a 10-digit mobile starting 6-9 (spaces/dashes allowed)
const MOBILE = /(?<![\d])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d])/g

const IDENTITY_LINE = /^-\s*(first name|last name|email|phone|linkedin|github)\s*:\s*(.+)$/i

function identityValues(path: string): string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.match(IDENTITY_LINE)?.[2]?.trim() ?? "")
    .filter(Boolean)
}

/**
 * The user's own identifying values from me/answers.md. Values still equal to
 * the fake ones in example/answers.md (a fresh `jp init`) are not personal.
 */
function personalValues(): string[] {
  const fake = new Set(identityValues(join(REPO_ROOT, "example", "answers.md")).map((v) => v.toLowerCase()))
  return identityValues(mePath("answers.md")).filter(
    (v) => v.length >= 3 && !fake.has(v.toLowerCase()) && !PLACEHOLDER_EMAIL.test(v) && !/example|0000/.test(v)
  )
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Whole-word, case-insensitive: a name like "Ravi" shouldn't match "Ravine". */
const containsValue = (text: string, v: string) => new RegExp(`(?<![\\w])${escape(v)}(?![\\w])`, "i").test(text)

const problems: string[] = []
const mine = personalValues()

for (const f of files) {
  if (f === "me" || f.startsWith("me/")) {
    problems.push(`${f}: files in me/ are personal and never committed`)
    continue
  }
  if (/\.(pdf|docx?)$/i.test(f) && !f.startsWith("example/")) {
    problems.push(`${f}: documents belong in me/ (only example/ may hold a fake one)`)
    continue
  }
  if (f === "scripts/check-private.ts" || /\.(pdf|png|jpe?g|gif|ico|woff2?)$/i.test(f)) continue
  // Staged content, not the working copy: that is what would be committed.
  const text = all ? readFileSync(join(REPO_ROOT, f), "utf8") : git("show", `:${f}`)
  for (const v of mine) if (containsValue(text, v)) problems.push(`${f}: contains your "${v}" from me/answers.md`)
  for (const m of text.match(EMAIL) ?? []) if (!PLACEHOLDER_EMAIL.test(m)) problems.push(`${f}: email address ${m}`)
  for (const m of text.match(MOBILE) ?? []) problems.push(`${f}: phone number ${m.trim()}`)
}

if (problems.length) {
  process.stderr.write(
    "Commit blocked: it would publish personal data.\n" +
      [...new Set(problems)].map((p) => `  - ${p}`).join("\n") +
      "\nUse placeholders (name@example.com, +91 00000 00000) or move the file to me/.\n"
  )
  process.exit(1)
}
if (all) process.stdout.write(`No personal data found in ${files.length} tracked files.\n`)
