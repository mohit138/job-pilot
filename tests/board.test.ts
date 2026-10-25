import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { boardHandler, pageMoveAllowed } from "../src/commands/board.ts"
import { jobCard, jobLink } from "../src/commands/cards.ts"
import type { StoredJob } from "../src/store.ts"

const t = "2026-10-18T00:00:00.000Z"
const stored = (id: string, status: StoredJob["status"], url = "https://example.com/x"): StoredJob => ({
  id, title: "Engineer", company: "Acme", location: null, date: null, url, department: null,
  status, score: 80, firstSeen: t, lastSeen: t, history: [{ at: t, status }],
})

const home = mkdtempSync(join(tmpdir(), "job-pilot-board-"))
const prev = process.env.JOB_PILOT_HOME
beforeAll(() => (process.env.JOB_PILOT_HOME = home))
afterAll(() => {
  rmSync(home, { recursive: true, force: true })
  if (prev === undefined) delete process.env.JOB_PILOT_HOME
  else process.env.JOB_PILOT_HOME = prev
})

const handle = boardHandler({ port: 4400, min: 60 })
const post = (body: unknown, host = "127.0.0.1:4400", origin = `http://${host}`) =>
  handle(new Request(`http://${host}/api/set`, { method: "POST", headers: { host, origin, "content-type": "application/json" }, body: JSON.stringify(body) }))
const jobs = () => JSON.parse(readFileSync(join(home, "jobs.json"), "utf8")).jobs

describe("board server", () => {
  test("answers only to its own loopback names (no DNS rebinding)", async () => {
    writeFileSync(join(home, "jobs.json"), JSON.stringify({ version: 1, jobs: {} }))
    const get = (host: string) => handle(new Request(`http://${host}/api/board`, { headers: { host } }))
    expect((await get("127.0.0.1:4400")).status).toBe(200)
    expect((await get("localhost:4400")).status).toBe(200)
    expect((await get("evil.example:4400")).status).toBe(403)
    expect((await get("127.0.0.1:9999")).status).toBe(403)
  })

  test("accepts posts from either loopback origin, refuses others", async () => {
    writeFileSync(join(home, "jobs.json"), JSON.stringify({ version: 1, jobs: { "a:1": stored("a:1", "ranked"), "a:2": stored("a:2", "ranked") } }))
    expect((await post({ id: "a:1", status: "approved" })).status).toBe(200)
    expect((await post({ id: "a:2", status: "approved" }, "localhost:4400")).status).toBe(200)
    expect((await post({ id: "a:2", status: "skipped" }, "127.0.0.1:4400", "http://evil.example")).status).toBe(403)
    expect(jobs()["a:1"].status).toBe("approved")
    expect(jobs()["a:2"].status).toBe("approved")
  })

  test("statuses are checked against the real list; prototype keys don't crash it", async () => {
    writeFileSync(join(home, "jobs.json"), JSON.stringify({ version: 1, jobs: { "a:1": stored("a:1", "ranked") } }))
    for (const status of ["constructor", "__proto__", "toString", "maybe"]) expect((await post({ id: "a:1", status })).status).toBe(400)
    expect((await post({ id: "constructor", status: "approved" })).status).toBe(404)
    expect((await post({ id: "a:1", status: "applied" })).status).toBe(409)
    expect(pageMoveAllowed("ranked", "constructor" as any)).toBe(false)
  })

  test("cards link only http(s) URLs", async () => {
    writeFileSync(join(home, "jobs.json"), JSON.stringify({ version: 1, jobs: { "a:1": { ...stored("a:1", "ranked", "javascript:alert(1)"), title: "<b>x</b>" } } }))
    const b = await (await handle(new Request("http://127.0.0.1:4400/api/board", { headers: { host: "127.0.0.1:4400" } }))).json()
    expect(b.shortlist[0].html).not.toContain("javascript:")
    expect(b.shortlist[0].html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(jobLink({ url: "https://example.com/1", title: "T" })).toContain('href="https://example.com/1"')
    expect(jobLink({ url: "data:text/html,x", title: "T" })).not.toContain("href")
    expect(jobCard(stored("a:2", "ranked"), [["approved", "Approve", "go"]])).toContain('data-s="approved"')
  })
})
