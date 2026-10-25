import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { applyUrl, pickNext } from "../src/commands/apply.ts"
import { pageMoveAllowed } from "../src/commands/board.ts"
import { DEMO_FORM } from "../src/commands/demo.ts"
import type { Company } from "../src/portals/registry.ts"
import type { Store, StoredJob } from "../src/store.ts"

const t = "2026-10-18T00:00:00.000Z"
const stored = (id: string, status: StoredJob["status"], score?: number): StoredJob => ({
  id, title: "Backend Engineer", company: "Acme", location: "Bengaluru", date: "2026-10-10",
  url: `https://jobs.lever.co/acme/${id.split(":")[1]}`, department: null, status, score, firstSeen: t, lastSeen: t,
  history: [{ at: t, status }],
})

describe("applyUrl", () => {
  const co = (ats: Company["ats"], board: Record<string, string> = {}) =>
    ({ name: "Acme", slug: "acme", ats, board, careersUrl: "", enabled: true, addedAt: "" }) as Company
  test("goes to the hiring system's own form where it has a fixed address", () => {
    expect(applyUrl({ id: "acme:123", url: "https://acme.com/jobs/123" }, co("greenhouse", { token: "acme" }))).toBe("https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123")
    expect(applyUrl({ id: "acme:1", url: "https://jobs.lever.co/acme/1" }, co("lever"))).toBe("https://jobs.lever.co/acme/1/apply")
    expect(applyUrl({ id: "acme:1", url: "https://jobs.lever.co/acme/1/apply" }, co("lever"))).toBe("https://jobs.lever.co/acme/1/apply")
    expect(applyUrl({ id: "acme:x", url: "https://jobs.ashbyhq.com/acme/x/" }, co("ashby"))).toBe("https://jobs.ashbyhq.com/acme/x/application")
    expect(applyUrl({ id: "acme:9", url: "https://wd.example/job/9" }, co("workday"))).toBe("https://wd.example/job/9")
    expect(applyUrl({ id: "acme:9", url: "https://example.com/j/9" })).toBe("https://example.com/j/9")
  })
})

describe("board moves", () => {
  test("the board can approve and skip, and mark applied only the job being applied to", () => {
    expect(pageMoveAllowed("ranked", "approved")).toBe(true)
    expect(pageMoveAllowed("approved", "ranked")).toBe(true)
    expect(pageMoveAllowed("applying", "applied")).toBe(true)
    expect(pageMoveAllowed("applying", "approved")).toBe(true)
    expect(pageMoveAllowed("applied", "skipped")).toBe(false)
    expect(pageMoveAllowed("approved", "applied")).toBe(false)
    expect(pageMoveAllowed("ranked", "applied")).toBe(false)
    expect(pageMoveAllowed("applying", "ranked")).toBe(false)
  })
})

describe("demo form", () => {
  test("never sends anything: no form action, submit is intercepted", () => {
    expect(DEMO_FORM).not.toMatch(/<form[^>]*action=/i)
    expect(DEMO_FORM).toContain("preventDefault()")
    expect(DEMO_FORM).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon/)
  })
})

describe("pickNext", () => {
  test("resumes a job already in progress before starting another", () => {
    const store: Store = { version: 1, jobs: { "a:1": stored("a:1", "approved", 90), "a:2": stored("a:2", "applying", 50) } }
    expect(pickNext(store)).toMatchObject({ job: { id: "a:2" }, resumed: true })
  })

  test("otherwise takes the best-scoring approved job, and nothing else", () => {
    const store: Store = { version: 1, jobs: {
      "a:1": stored("a:1", "approved", 70), "a:2": stored("a:2", "approved", 85), "a:3": stored("a:3", "ranked", 99),
    } }
    expect(pickNext(store)).toMatchObject({ job: { id: "a:2" }, resumed: false })
    expect(pickNext({ version: 1, jobs: { "a:3": stored("a:3", "ranked", 99) } })).toBeNull()
  })
})

const CLI = join(import.meta.dir, "../src/cli.ts")
const home = mkdtempSync(join(tmpdir(), "job-pilot-apply-"))
afterAll(() => rmSync(home, { recursive: true, force: true }))

async function jp(...args: string[]) {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, JOB_PILOT_HOME: home } })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
const code = (r: { stderr: string }) => JSON.parse(r.stderr).code
const jobs = () => JSON.parse(readFileSync(join(home, "jobs.json"), "utf8")).jobs

describe("jp apply", () => {
  test("hands out one job at a time and records each step", async () => {
    writeFileSync(join(home, "companies.json"), JSON.stringify({ version: 1, companies: [
      { name: "Acme", slug: "acme", ats: "lever", board: { company: "acme" }, careersUrl: "https://jobs.lever.co/acme", enabled: true, addedAt: t },
    ] }))
    writeFileSync(join(home, "jobs.json"), JSON.stringify({ version: 1, jobs: {
      "acme:1": stored("acme:1", "approved", 80), "acme:2": stored("acme:2", "approved", 60), "acme:3": stored("acme:3", "ranked", 95),
    } }))

    const first = JSON.parse((await jp("apply", "next")).stdout)
    expect(first.job.id).toBe("acme:1")
    expect(first.applyUrl).toBe("https://jobs.lever.co/acme/1/apply")
    expect(first.supported).toBe(true)
    expect(first.remaining).toBe(1)
    expect(first.missingFiles).toEqual(["answers", "profile", "resume"])
    expect(jobs()["acme:1"].status).toBe("applying")

    // Asking again resumes the same job instead of starting a second one.
    const again = JSON.parse((await jp("apply", "next")).stdout)
    expect(again).toMatchObject({ job: { id: "acme:1" }, resumed: true, lastStep: "Opening the application" })

    expect(code(await jp("apply", "step", "acme:1"))).toBe("NO_NOTE")
    expect((await jp("apply", "step", "acme:1", "--note", "Ready for you: fill 2 fields, then submit")).exitCode).toBe(0)
    expect(jobs()["acme:1"].history.at(-1)).toMatchObject({ status: "applying", note: "Ready for you: fill 2 fields, then submit" })

    // Only the job in progress can be marked applied.
    expect(code(await jp("apply", "done", "acme:2"))).toBe("NOT_APPLYING")
    expect((await jp("apply", "done", "acme:1")).exitCode).toBe(0)
    expect(jobs()["acme:1"]).toMatchObject({ status: "applied" })
    expect(jobs()["acme:1"].history.at(-1).note).toBe("You submitted it")
    expect(jobs()["acme:1"].appliedAt).toBeTruthy()

    const second = JSON.parse((await jp("apply", "next")).stdout)
    expect(second.job.id).toBe("acme:2")
    expect((await jp("apply", "later", "acme:2")).exitCode).toBe(0)
    expect(jobs()["acme:2"].status).toBe("approved")

    await jp("apply", "next")
    expect((await jp("apply", "fail", "acme:2", "--note", "Posting closed")).exitCode).toBe(0)
    expect(jobs()["acme:2"].status).toBe("failed")

    expect(JSON.parse((await jp("apply", "next")).stdout).job).toBeNull()
    expect(code(await jp("apply", "submit"))).toBe("BAD_ACTION")
  })

  test("a demo job points at the board's practice form, is never resumed as real, and leaves no trace", async () => {
    writeFileSync(join(home, "jobs.json"), JSON.stringify({ version: 1, jobs: { "acme:5": stored("acme:5", "approved", 70) } }))
    const demo = JSON.parse((await jp("apply", "demo")).stdout)
    expect(demo).toMatchObject({ job: { id: "demo:practice" }, applyUrl: "http://127.0.0.1:4317/demo", ats: "greenhouse", supported: true })
    expect(jobs()["demo:practice"].status).toBe("applying")
    expect((await jp("apply", "step", "demo:practice", "--note", "Ready for you: fill 3 fields, then submit")).exitCode).toBe(0)

    // The real queue carries on as if the demo weren't there.
    expect(JSON.parse((await jp("apply", "next")).stdout).job.id).toBe("acme:5")

    expect(JSON.parse((await jp("apply", "done", "demo:practice")).stdout)).toMatchObject({ removed: true })
    expect(jobs()["demo:practice"]).toBeUndefined()
  })

  test("the demo job uses the port the board last started on", async () => {
    writeFileSync(join(home, ".board-port"), "5123\n")
    const demo = JSON.parse((await jp("apply", "demo")).stdout)
    expect(demo.applyUrl).toBe("http://127.0.0.1:5123/demo")
    await jp("apply", "done", "demo:practice")
    rmSync(join(home, ".board-port"))
  })
})
