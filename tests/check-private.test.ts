import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs"
import { spawnSync } from "child_process"
import { tmpdir } from "os"
import { join } from "path"
import { listFiles, pathProblem, phoneNumbers, scan, secretsFrom, textProblems } from "../scripts/check-private.ts"

const none = { hard: [], soft: [] }
// Built at runtime so this file doesn't trip the guard it tests.
const mail = (user: string) => `${user}@` + "realmail.test"
const phone = (...parts: string[]) => parts.join("")
const repo = mkdtempSync(join(tmpdir(), "job-pilot-guard-"))
afterAll(() => rmSync(repo, { recursive: true, force: true }))
const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo })

describe("privacy guard", () => {
  test("names with non-ASCII letters or spaces are checked, not skipped", () => {
    git("init", "-q")
    writeFileSync(join(repo, "résumé notes.txt"), `mail me: ${mail("someone")}\n`)
    git("add", ".")
    expect(listFiles(repo, false)).toEqual(["résumé notes.txt"])
    expect(scan(repo, false, none, ["me"]).problems).toEqual([`résumé notes.txt: email address ${mail("someone")}`])
  })

  test("--all skips tracked files that were deleted", () => {
    writeFileSync(join(repo, "gone.txt"), "x")
    git("add", ".")
    git("commit", "-qm", "c")
    unlinkSync(join(repo, "gone.txt"))
    expect(() => scan(repo, true, none, ["me"])).not.toThrow()
    expect(listFiles(repo, true)).not.toContain("gone.txt")
  })

  test("blocks the private folder wherever it is, and resume-like files outside example/", () => {
    expect(pathProblem("me/answers.md", ["me"])).toBeTruthy()
    expect(pathProblem("private/jobs.json", ["me", "private"])).toBeTruthy()
    expect(pathProblem("docs/photo.HEIC", ["me"])).toBeTruthy()
    expect(pathProblem("cv.pages", ["me"])).toBeTruthy()
    expect(pathProblem("example/resume.pdf", ["me"])).toBeNull()
    expect(pathProblem("src/cli.ts", ["me"])).toBeNull()
  })

  test("phone numbers from any country; placeholders pass", () => {
    const uk = phone("+44 ", "7911 ", "123456")
    const us = phone("+1-", "415-", "555-", "2671")
    expect(phoneNumbers(`call ${uk}`)).toEqual([uk])
    expect(phoneNumbers(`call ${us} now`)).toEqual([us])
    expect(phoneNumbers(phone("+91 ", "98765 ", "43210"))).toHaveLength(1)
    expect(phoneNumbers("+91 00000 00000 and +1 000 000 0000")).toEqual([])
    expect(phoneNumbers("version +1.2, offset +05:30, 2026-10-18")).toEqual([])
  })

  test("reads distinctive values from profile.md; companies only block where a change adds them", () => {
    const dir = mkdtempSync(join(tmpdir(), "job-pilot-me-"))
    writeFileSync(join(dir, "answers.md"), `- First name: Priya\n- Last name: Raman\n- Email: ${mail("priya")}\n`)
    writeFileSync(join(dir, "profile.md"), "- Name: Priya Raman\n- Current role: Staff Engineer at Zentrix Labs (since 2022)\n- Before: SDE at Quorvo, 2019 to 2022\n")
    const s = secretsFrom(join(dir, "answers.md"), join(dir, "profile.md"))
    rmSync(dir, { recursive: true, force: true })
    expect(s.hard).toContain("Priya Raman")
    expect(s.soft).toEqual(expect.arrayContaining(["Priya", "Raman", "Zentrix Labs", "Quorvo"]))
    expect(textProblems("a.md", "by priya raman", s)).toContain('a.md: contains your "Priya Raman" from me/')
    expect(textProblems("a.md", "worked at Quorvo", s)).toEqual(['a.md: adds your "Quorvo" from me/'])
    expect(textProblems("a.md", "worked at Quorvo", s, "Quorvo was here before")).toEqual([])
    expect(textProblems("a.md", "Quorvoish", s)).toEqual([])
  })

  test("the guard's own pattern lines are not data, the rest of it is", () => {
    const own = readFileSync(join(import.meta.dir, "../scripts/check-private.ts"), "utf8")
    expect(textProblems("scripts/check-private.ts", own, none)).toEqual([])
    expect(textProblems("scripts/check-private.ts", own + `\n// ping ${mail("someone")}\n`, none)).toHaveLength(1)
  })
})
