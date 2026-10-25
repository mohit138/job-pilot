import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { Job } from "../src/portals/adapters.ts"
import { canMove, loadStore, mergeScraped, saveStore, setStatus, updateStore, type Store } from "../src/store.ts"
import { excludedByTitle } from "../src/settings.ts"

const job = (id: string, title = "Software Engineer"): Job => ({
  id,
  title,
  company: "Acme",
  location: "Bengaluru",
  date: "2026-10-01",
  url: `https://example.com/${id}`,
  department: null,
})

describe("mergeScraped", () => {
  test("new jobs are added once; known ones are counted, not re-added", () => {
    const store: Store = { version: 1, jobs: {} }
    const first = mergeScraped(store, [job("acme:1"), job("acme:2")])
    expect(first.added.map((j) => j.id)).toEqual(["acme:1", "acme:2"])
    expect(store.jobs["acme:1"].status).toBe("new")

    const second = mergeScraped(store, [job("acme:1"), job("acme:3")])
    expect(second.added.map((j) => j.id)).toEqual(["acme:3"])
    expect(second.known).toBe(1)
  })

  test("applied and skipped jobs stay as they are and are reported", () => {
    const store: Store = { version: 1, jobs: {} }
    mergeScraped(store, [job("acme:1"), job("acme:2")])
    setStatus(store.jobs["acme:1"], "applied")
    setStatus(store.jobs["acme:2"], "skipped")
    const again = mergeScraped(store, [job("acme:1"), job("acme:2")])
    expect(again.added).toHaveLength(0)
    expect(again.alreadyDone).toBe(2)
    expect(store.jobs["acme:1"].status).toBe("applied")
    expect(store.jobs["acme:1"].appliedAt).toBeTruthy()
  })

  test("a closed job that reappears comes back as new", () => {
    const store: Store = { version: 1, jobs: {} }
    mergeScraped(store, [job("acme:1")])
    setStatus(store.jobs["acme:1"], "closed")
    mergeScraped(store, [job("acme:1")])
    expect(store.jobs["acme:1"].status).toBe("new")
    expect(store.jobs["acme:1"].history.map((h) => h.status)).toEqual(["new", "closed", "new"])
  })

  test("a job once applied to is never reopened as new, even if closed and seen again", () => {
    const store: Store = { version: 1, jobs: {} }
    mergeScraped(store, [job("acme:1")])
    setStatus(store.jobs["acme:1"], "applied")
    setStatus(store.jobs["acme:1"], "closed")
    mergeScraped(store, [job("acme:1")])
    expect(store.jobs["acme:1"].status).toBe("closed")
  })

  test("only http(s) links are kept", () => {
    const store: Store = { version: 1, jobs: {} }
    mergeScraped(store, [{ ...job("acme:1"), url: "javascript:alert(1)" }, { ...job("acme:2"), url: "http://acme.test/2" }])
    expect(store.jobs["acme:1"].url).toBe("")
    expect(store.jobs["acme:2"].url).toBe("http://acme.test/2")
  })
})

describe("jobs file writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-pilot-store-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test("updateStore works on a fresh read, so changes made meanwhile survive", () => {
    const path = join(dir, "fresh.json")
    saveStore(path, { version: 1, jobs: {} })
    const stale = loadStore(path) // what a slow scrape read at the start
    updateStore(path, (s) => mergeScraped(s, [job("acme:1")])) // a `jp set`/board change meanwhile
    updateStore(path, (s) => mergeScraped(s, [job("acme:2")])) // the scrape finishing
    expect(Object.keys(loadStore(path).jobs).sort()).toEqual(["acme:1", "acme:2"])
    expect(stale.jobs).toEqual({})
    expect(existsSync(`${path}.lock`)).toBe(false)
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([])
  })

  test("a lock left by a crashed process is taken over", () => {
    const path = join(dir, "stale.json")
    writeFileSync(`${path}.lock`, "")
    const old = new Date(Date.now() - 60_000)
    utimesSync(`${path}.lock`, old, old)
    expect(updateStore(path, (s) => mergeScraped(s, [job("acme:1")]).added.length)).toBe(1)
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  test("concurrent writers from separate processes all land", async () => {
    const path = join(dir, "race.json")
    const store = join(import.meta.dir, "../src/store.ts")
    const script = (i: number) =>
      `import { updateStore } from ${JSON.stringify(store)}
       for (let k = 0; k < 10; k++) updateStore(${JSON.stringify(path)}, (s) => { s.jobs["p${i}:" + k] = { id: "p${i}:" + k } as any })`
    const procs = [0, 1, 2, 3].map((i) => Bun.spawn(["bun", "-e", script(i)], { stdout: "ignore", stderr: "pipe" }))
    expect(await Promise.all(procs.map((p) => p.exited))).toEqual([0, 0, 0, 0])
    expect(Object.keys(loadStore(path).jobs)).toHaveLength(40)
  })
})

describe("status rules", () => {
  test("applied jobs can't be moved without force", () => {
    expect(canMove("applied", "new")).toBe(false)
    expect(canMove("applied", "applied")).toBe(true)
    expect(canMove("approved", "skipped")).toBe(true)
  })
})

describe("excludedByTitle", () => {
  test("whole words, case-insensitive", () => {
    expect(excludedByTitle("Software Engineering Intern", ["intern"])).toBe(true)
    expect(excludedByTitle("Internal Tools Engineer", ["intern"])).toBe(false)
    expect(excludedByTitle("Engineering Manager", ["Manager"])).toBe(true)
    expect(excludedByTitle("Engineer", [])).toBe(false)
  })
})
