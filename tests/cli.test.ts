import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const CLI = join(import.meta.dir, "../src/cli.ts")
const home = mkdtempSync(join(tmpdir(), "job-pilot-test-"))
afterAll(() => rmSync(home, { recursive: true, force: true }))

async function jp(...args: string[]) {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, JOB_PILOT_HOME: home } })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
const code = (r: { stderr: string }) => JSON.parse(r.stderr).code

describe("cli", () => {
  test("unknown flags are refused, never ignored", async () => {
    const r = await jp("scrape", "--bogus")
    expect(r.exitCode).toBe(1)
    expect(code(r)).toBe("UNKNOWN_FLAG")
  })

  test("init copies the fake examples into the private folder", async () => {
    const r = await jp("init")
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).created).toContain("answers.md")
    expect(readFileSync(join(home, "profile.md"), "utf8")).toContain("Alex Sample")
    // A second run keeps what is there.
    writeFileSync(join(home, "profile.md"), "mine")
    await jp("init")
    expect(readFileSync(join(home, "profile.md"), "utf8")).toBe("mine")
  })

  test("jobs and set work on the jobs file", async () => {
    const t = "2026-10-18T00:00:00.000Z"
    const stored = (id: string) => ({
      id, title: "Backend Engineer", company: "Acme", location: "Bengaluru", date: "2026-10-10",
      url: "https://example.com/x", department: null, status: "new", firstSeen: t, lastSeen: t, history: [{ at: t, status: "new" }],
    })
    writeFileSync(join(home, "jobs.json"), JSON.stringify({ version: 1, jobs: { "acme:1": stored("acme:1"), "acme:2": stored("acme:2") } }))

    expect((await jp("jobs")).stdout).toContain("2 jobs in file: new 2")
    const set = await jp("set", "acme:1", "-s", "applied")
    expect(set.exitCode).toBe(0)

    const back = await jp("set", "acme:1", "-s", "new")
    expect(back.exitCode).toBe(1)
    expect(code(back)).toBe("ALREADY_APPLIED")

    expect(code(await jp("set", "acme:9", "-s", "approved"))).toBe("UNKNOWN_JOB")
    expect(code(await jp("set", "acme:2", "-s", "maybe"))).toBe("BAD_STATUS")

    const applied = JSON.parse((await jp("jobs", "-s", "applied", "--format", "json")).stdout)
    expect(applied.jobs.map((j: any) => j.id)).toEqual(["acme:1"])

    // A value may start with "-" when the flag takes one.
    expect((await jp("set", "acme:2", "-s", "skipped", "--note", "- missing visa")).exitCode).toBe(0)
    const two = JSON.parse(readFileSync(join(home, "jobs.json"), "utf8")).jobs["acme:2"]
    expect(two.history.at(-1)).toMatchObject({ status: "skipped", note: "- missing visa" })
  })

  test("shortlist lists ranked jobs above the cut-off, best first, numbered", async () => {
    const t = "2026-10-18T00:00:00.000Z"
    const j = (id: string, status: string, score?: number) => ({
      id, title: `Role <${id}>`, company: "Acme", location: "Bengaluru", date: "2026-10-10", url: "https://example.com/x",
      department: null, status, score, firstSeen: t, lastSeen: t, history: [],
    })
    writeFileSync(join(home, "jobs.json"), JSON.stringify({ version: 1, jobs: {
      "acme:a": j("acme:a", "ranked", 55), "acme:b": j("acme:b", "ranked", 90), "acme:c": j("acme:c", "approved", 70),
      "acme:d": j("acme:d", "applied", 95), "acme:e": j("acme:e", "new"),
    } }))
    const r = await jp("shortlist")
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).rows.map((x: any) => [x.n, x.id])).toEqual([[1, "acme:b"], [2, "acme:c"]])
    const html = readFileSync(join(home, "shortlist.html"), "utf8")
    expect(html).toContain("Role &lt;acme:b&gt;")
    expect(html).toContain("1 applied · 1 not ranked yet")
    expect(JSON.parse((await jp("shortlist", "--min", "50")).stdout).rows).toHaveLength(3)
    expect(JSON.parse((await jp("jobs", "-n", "2", "--format", "json")).stdout).count).toBe(2)
  })

  test("scrape with no companies explains how to add one", async () => {
    writeFileSync(join(home, "companies.json"), JSON.stringify({ version: 1, companies: [] }))
    const r = await jp("scrape")
    expect(r.exitCode).toBe(1)
    expect(code(r)).toBe("NO_COMPANIES")
  })
})
