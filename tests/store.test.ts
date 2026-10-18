import { describe, expect, test } from "bun:test"
import type { Job } from "../src/portals/adapters.ts"
import { canMove, mergeScraped, setStatus, type Store } from "../src/store.ts"
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
