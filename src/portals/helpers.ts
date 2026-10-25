// Shared fetch, parsing and filtering helpers for the portal readers.
// Every ATS adapter goes through jsonFetch/textFetch so robots.txt, per-host
// pacing, backoff, timeouts and the honest User-Agent are applied uniformly.

import { clearRobotsCache, robotsAllows, UA } from "./robots.ts"

export { UA }

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** The URL if it is http(s), else "" (a feed could hand us javascript: or data: links). */
export function httpUrl(url: unknown): string {
  if (typeof url !== "string") return ""
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? url : ""
  } catch {
    return ""
  }
}

interface FetchOpts {
  method?: "GET" | "POST"
  body?: unknown
  accept?: string
}

/** Politeness per host: at most `perHost` requests in flight, starts at least `gapMs` apart. Tests may change it. */
export const PACING = { perHost: 2, gapMs: 300, maxRetryAfterMs: 30_000 }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const hosts = new Map<string, { active: number; waiting: (() => void)[]; next: number }>()

async function hostSlot(host: string): Promise<() => void> {
  let h = hosts.get(host)
  if (!h) hosts.set(host, (h = { active: 0, waiting: [], next: 0 }))
  if (h.active < PACING.perHost) h.active++
  else await new Promise<void>((r) => h!.waiting.push(r)) // the releaser hands its slot over
  const wait = h.next - Date.now()
  h.next = Math.max(Date.now(), h.next) + PACING.gapMs
  if (wait > 0) await sleep(wait)
  return () => {
    const next = h!.waiting.shift()
    if (next) next()
    else h!.active--
  }
}

/** Retry-After as milliseconds (seconds or an HTTP date), capped; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const secs = Number(header)
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - now
  if (!Number.isFinite(ms)) return null
  return Math.min(Math.max(ms, 0), PACING.maxRetryAfterMs)
}

export class RobotsDisallowed extends Error {}

/**
 * Fetch with backoff + jitter on 429/5xx (honouring Retry-After), one host's
 * pace at a time. Returns null on 404. Throws RobotsDisallowed for a URL the
 * host's robots.txt doesn't allow, so callers report it instead of treating
 * the job as gone.
 */
export async function rawFetch(url: string, opts: FetchOpts = {}): Promise<string | null> {
  if (!(await robotsAllows(url))) throw new RobotsDisallowed(`robots.txt disallows ${url}`)
  const release = await hostSlot(new URL(url).host)
  try {
    const maxRetries = 6
    let delay = 500
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept: opts.accept ?? "application/json, text/html;q=0.9, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      }
      if (opts.body !== undefined) headers["Content-Type"] = "application/json"
      const response = await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      })
      if (response.status === 429 || response.status >= 500) {
        if (attempt === maxRetries) {
          throw new HttpError(response.status, `Request failed: ${response.status} ${response.statusText} (${url})`)
        }
        const asked = response.status === 429 || response.status === 503 ? retryAfterMs(response.headers.get("retry-after")) : null
        await sleep(asked ?? delay + Math.floor(Math.random() * 500))
        delay = Math.min(delay * 2, 8000)
        continue
      }
      if (response.status === 404) return null
      if (!response.ok) {
        throw new HttpError(response.status, `Request failed: ${response.status} ${response.statusText} (${url})`)
      }
      return response.text()
    }
    throw new Error("Request failed after max retries")
  } finally {
    release()
  }
}

export async function jsonFetch<T = any>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  const text = await rawFetch(url, opts)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Expected JSON from ${url} but got: ${text.slice(0, 120)}`)
  }
}

export async function textFetch(url: string): Promise<string | null> {
  return rawFetch(url, { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" })
}

// Whole boards and feeds, fetched once per run: every query of a scrape and
// every describe of the same company reuse the first copy.
const boards = new Map<string, Promise<unknown>>()

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = boards.get(key) as Promise<T> | undefined
  if (!p) {
    p = load()
    boards.set(key, p)
    p.catch(() => boards.delete(key)) // a failure may be retried
  }
  return p
}

export const cachedJson = <T = any>(url: string) => once(`json ${url}`, () => jsonFetch<T>(url))
export const cachedText = (url: string) => once(`text ${url}`, () => textFetch(url))

/** For tests: forget cached boards, robots.txt verdicts and host pacing. */
export function resetFetchState(): void {
  boards.clear()
  hosts.clear()
  clearRobotsCache()
}

// ---------------------------------------------------------------------------
// Text helpers

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
}

/** HTML fragment -> readable plain text with paragraph breaks preserved. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  // Greenhouse returns entity-escaped HTML; decode once first if it looks escaped.
  let s = /&lt;\w/.test(html) ? decodeHtmlEntities(html) : html
  s = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|li|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  s = decodeHtmlEntities(s)
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Acronyms that title-casing a URL slug would otherwise turn into "Ai", "Sre", ...
const ACRONYMS = new Set(["ai", "ml", "sre", "qa", "ui", "ux", "api", "aws", "gcp", "sql", "sdk", "it", "hr", "devops", "ios"])

export function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase()
      if (lower === "devops") return "DevOps"
      if (lower === "ios") return "iOS"
      if (ACRONYMS.has(lower)) return lower.toUpperCase()
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(" ")
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
}

// ---------------------------------------------------------------------------
// Dates

/** Normalise many date shapes to YYYY-MM-DD, or null. */
export function toDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null
  let d: Date
  if (typeof value === "number") {
    // seconds vs milliseconds
    d = new Date(value < 1e12 ? value * 1000 : value)
  } else {
    d = new Date(value)
  }
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

export function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Workday "Posted Today" / "Posted Yesterday" / "Posted 5 Days Ago" / "Posted 30+ Days Ago". */
export function parseRelativePosted(text: string | null | undefined): string | null {
  if (!text) return null
  const t = text.toLowerCase()
  if (t.includes("today")) return daysAgo(0)
  if (t.includes("yesterday")) return daysAgo(1)
  const m = t.match(/(\d+)\+?\s*day/)
  if (m) return daysAgo(parseInt(m[1], 10))
  return null
}

// ---------------------------------------------------------------------------
// Location + query matching

// City alias groups: any member matches any other. Extend freely.
const CITY_ALIASES: string[][] = [
  ["bengaluru", "bangalore", "blr"],
  ["gurugram", "gurgaon"],
  ["mumbai", "bombay", "navi mumbai", "thane"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["pune", "poona"],
  ["hyderabad", "secunderabad"],
  ["noida", "greater noida", "delhi", "new delhi", "ncr"],
  ["thiruvananthapuram", "trivandrum"],
  ["kochi", "cochin"],
  ["mysuru", "mysore"],
]

export function locationTerms(location: string): string[] {
  const parts = location
    .toLowerCase()
    .split(/[,|/]/)
    .map((p) => p.trim())
    .filter(Boolean)
  // Only the first part (the city) drives matching: "Bengaluru, Karnataka, India" -> bengaluru.
  const city = parts[0] ?? ""
  for (const group of CITY_ALIASES) {
    if (group.includes(city)) return group
  }
  return city ? [city] : []
}

export function matchesLocation(
  jobLocation: string | null,
  location: string | undefined,
  includeRemote: boolean
): boolean {
  if (!location) return true
  const loc = (jobLocation ?? "").toLowerCase()
  if (!loc) return true // unknown location: keep, let the user/ranker decide
  // Remote counts only when it is open to India: "Remote - India", "Remote", "Anywhere".
  // "Canada-Remote" is remote somewhere else and is dropped.
  if (includeRemote && /remote/.test(loc) && (/india|anywhere|worldwide/.test(loc) || /^\W*remote\W*$/.test(loc))) return true
  return locationTerms(location).some((t) => loc.includes(t))
}

/** Client-side keyword match: every word of the query must appear in the title. */
export function matchesQuery(title: string, query: string | undefined): boolean {
  if (!query) return true
  const t = title.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w))
}
