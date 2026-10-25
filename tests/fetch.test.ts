// The shared fetch path, with fetch stubbed: robots.txt per request, per-run
// board caching, per-host pacing and Retry-After. No network.

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { ADAPTERS } from "../src/portals/adapters.ts"
import { jsonFetch, PACING, rawFetch, resetFetchState, retryAfterMs, RobotsDisallowed } from "../src/portals/helpers.ts"
import type { Company } from "../src/portals/registry.ts"
import { runDescribe } from "../src/commands/describe.ts"

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
const realFetch = globalThis.fetch
let calls: string[] = []

function stub(routes: Record<string, Handler | object | string>, robots = "") {
  calls = []
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith("/robots.txt")) return robots ? new Response(robots) : new Response("", { status: 404 })
    const r = routes[url]
    if (r === undefined) return new Response("", { status: 404 })
    if (typeof r === "function") return (r as Handler)(url, init)
    return new Response(typeof r === "string" ? r : JSON.stringify(r))
  }) as typeof fetch
}

const saved = { ...PACING }
beforeEach(() => {
  resetFetchState()
  Object.assign(PACING, { gapMs: 0 })
})
afterEach(() => {
  globalThis.fetch = realFetch
  Object.assign(PACING, saved)
})

const co = (ats: Company["ats"], board: Record<string, string>): Company =>
  ({ name: "Acme", slug: "acme", ats, board, careersUrl: "", enabled: true, addedAt: "" }) as Company

describe("robots.txt on every request", () => {
  test("a disallowed URL is refused without being fetched; robots.txt is read once per host", async () => {
    stub({ "https://a.test/ok": { ok: 1 }, "https://a.test/private/x": { secret: 1 } }, "User-agent: *\nDisallow: /private\n")
    expect(await jsonFetch<any>("https://a.test/ok")).toEqual({ ok: 1 })
    await expect(rawFetch("https://a.test/private/x")).rejects.toBeInstanceOf(RobotsDisallowed)
    expect(await jsonFetch<any>("https://a.test/ok")).toEqual({ ok: 1 })
    expect(calls.filter((u) => u.endsWith("/robots.txt"))).toHaveLength(1)
    expect(calls).not.toContain("https://a.test/private/x")
  })

  test("a rule for job-pilot applies; one for another bot doesn't", async () => {
    stub({ "https://b.test/jobs": [] }, "User-agent: job-pilot-not\nAllow: /\nUser-agent: Job-Pilot\nDisallow: /jobs\n")
    await expect(rawFetch("https://b.test/jobs")).rejects.toBeInstanceOf(RobotsDisallowed)
  })
})

describe("request volume", () => {
  test("a company's board is fetched once per run, however many searches and details need it", async () => {
    const board = "https://api.ashbyhq.com/posting-api/job-board/acme"
    stub({ [board]: { jobs: [{ id: "x", title: "Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/x", descriptionPlain: "Do things" }, { id: "y", title: "SRE", jobUrl: "https://jobs.ashbyhq.com/acme/y" }] } })
    const c = co("ashby", { name: "acme" })
    await ADAPTERS.ashby.search(c, { query: "a", maxResults: 50 })
    await ADAPTERS.ashby.search(c, { query: "b", maxResults: 50 })
    expect((await ADAPTERS.ashby.detail(c, "x"))?.description).toBe("Do things")
    expect(await ADAPTERS.ashby.detail(c, "y")).toBeTruthy()
    expect(calls.filter((u) => u === board)).toHaveLength(1)
  })

  test("at most PACING.perHost requests to one host at a time", async () => {
    let inFlight = 0
    let peak = 0
    const slow: Handler = async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight--
      return new Response("{}")
    }
    stub(Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`https://c.test/${i}`, slow])))
    await Promise.all([1, 2, 3, 4, 5, 6].map((i) => rawFetch(`https://c.test/${i}`)))
    expect(peak).toBe(PACING.perHost)
  })

  test("Retry-After on 429 is honoured, then the request goes through", async () => {
    let n = 0
    stub({ "https://d.test/x": () => (n++ === 0 ? new Response("", { status: 429, headers: { "Retry-After": "0" } }) : new Response('{"ok":true}')) })
    const t = Date.now()
    expect(await jsonFetch<{ ok: boolean }>("https://d.test/x")).toEqual({ ok: true })
    expect(n).toBe(2)
    expect(Date.now() - t).toBeLessThan(400) // waited what it was told (0s), not the default backoff
  })

  test("Retry-After parsing: seconds, dates, capped", () => {
    expect(retryAfterMs("5")).toBe(5000)
    expect(retryAfterMs(null)).toBeNull()
    expect(retryAfterMs("soon")).toBeNull()
    expect(retryAfterMs("86400")).toBe(PACING.maxRetryAfterMs)
    const now = Date.parse("2026-10-25T00:00:00Z")
    expect(retryAfterMs("Sun, 25 Oct 2026 00:00:10 GMT", now)).toBe(10_000)
  })
})

describe("job links", () => {
  test("adapters drop non-http(s) links, and feeds resolve relative ones", async () => {
    stub({
      "https://careers.acme.test/jobs.json": { jobs: [
        { id: 1, title: "Engineer", link: "javascript:alert(1)" },
        { id: 2, title: "SRE", link: "/jobs/2" },
      ] },
    })
    const jobs = await ADAPTERS.jsonfeed.search(co("jsonfeed", { url: "https://careers.acme.test/jobs.json", title: "title", link: "link", id: "id" }), { maxResults: 50 })
    expect(jobs.map((j) => [j.id, j.url])).toEqual([["acme:2", "https://careers.acme.test/jobs/2"]])

    stub({ "https://api.lever.co/v0/postings/acme?mode=json": [{ id: "z", text: "Engineer", hostedUrl: "data:text/html,hi", categories: {} }] })
    expect((await ADAPTERS.lever.search(co("lever", { company: "acme" }), { maxResults: 50 }))[0].url).toBe("")
  })
})

describe("jp describe", () => {
  const home = mkdtempSync(join(tmpdir(), "job-pilot-describe-"))
  const prev = process.env.JOB_PILOT_HOME
  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    if (prev === undefined) delete process.env.JOB_PILOT_HOME
    else process.env.JOB_PILOT_HOME = prev
  })
  const t = "2026-10-18T00:00:00.000Z"
  const stored = (id: string, status: string) => ({
    id, title: "Engineer", company: "Acme", location: null, date: null, url: "https://example.com/x", department: null,
    status, firstSeen: t, lastSeen: t, history: [{ at: t, status }],
  })

  test("closes only jobs still on the way, and keeps changes made while it fetched", async () => {
    process.env.JOB_PILOT_HOME = home
    writeFileSync(join(home, "companies.json"), JSON.stringify({ version: 1, companies: [
      { name: "Acme", slug: "acme", ats: "greenhouse", board: { token: "acme" }, careersUrl: "", enabled: true, addedAt: t },
    ] }))
    const jobsFile = join(home, "jobs.json")
    writeFileSync(jobsFile, JSON.stringify({ version: 1, jobs: {
      "acme:1": stored("acme:1", "new"), "acme:2": stored("acme:2", "applied"), "acme:3": stored("acme:3", "ranked"),
    } }))
    const api = "https://boards-api.greenhouse.io/v1/boards/acme/jobs"
    stub({
      [`${api}/3`]: () => {
        // Someone approves acme:3 on the board while describe is fetching.
        const f = JSON.parse(readFileSync(jobsFile, "utf8"))
        f.jobs["acme:3"].status = "approved"
        writeFileSync(jobsFile, JSON.stringify(f))
        return new Response(JSON.stringify({ id: 3, title: "Engineer", content: "<p>Build</p>", absolute_url: "https://example.com/3" }))
      },
    }) // acme:1 and acme:2 are gone (404)
    const write = process.stdout.write
    process.stdout.write = (() => true) as any
    try {
      await runDescribe({ ids: ["acme:1", "acme:2", "acme:3"], statuses: [] })
    } finally {
      process.stdout.write = write
    }
    const jobs = JSON.parse(readFileSync(jobsFile, "utf8")).jobs
    expect(jobs["acme:1"].status).toBe("closed")
    expect(jobs["acme:2"].status).toBe("applied")
    expect(jobs["acme:3"]).toMatchObject({ status: "approved", description: "Build" })
  })
})
