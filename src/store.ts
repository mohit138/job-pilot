// The jobs file (me/jobs.json): every job Job Pilot has ever seen, with its
// status. It is the memory that stops re-scraping, re-ranking and re-applying.
// Keyed by "<company-slug>:<portal job id>", which is stable per posting.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs"
import { dirname } from "path"
import type { Job } from "./portals/adapters.ts"
import { httpUrl } from "./portals/helpers.ts"
import { mePath } from "./paths.ts"

export const STATUSES = ["new", "ranked", "approved", "applying", "applied", "skipped", "failed", "closed"] as const
export type Status = (typeof STATUSES)[number]

/** Statuses that end a job's run; scrape reports known jobs in them as already applied or skipped. */
export const DONE: Status[] = ["applied", "skipped"]

export interface HistoryEntry {
  at: string
  status: Status
  note?: string
}

export interface StoredJob extends Job {
  status: Status
  firstSeen: string
  lastSeen: string
  /** Full job text from the portal, fetched once by `jp describe`. */
  description?: string
  /** 0-100, set by /rank. */
  score?: number
  /** One line from /rank on why it scored that way. */
  rankNote?: string
  appliedAt?: string
  history: HistoryEntry[]
}

export interface Store {
  version: 1
  jobs: Record<string, StoredJob>
}

export function storePath(override?: string): string {
  return override ?? mePath("jobs.json")
}

export function loadStore(path: string): Store {
  if (!existsSync(path)) return { version: 1, jobs: {} }
  const data = JSON.parse(readFileSync(path, "utf8"))
  if (typeof data.jobs !== "object" || data.jobs === null) throw new Error(`Malformed jobs file at ${path}: missing "jobs" object`)
  return { version: 1, jobs: data.jobs }
}

/** Atomic write: a crash mid-save never leaves a half-written jobs file. */
export function saveStore(path: string, store: Store): void {
  mkdirSync(dirname(path), { recursive: true })
  // Unique per writer, so two processes saving at once never share a temp file.
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n")
  renameSync(tmp, path)
}

/** A lock older than this is from a crashed process and is taken over. */
const STALE_LOCK_MS = 10_000
const LOCK_WAIT_MS = 15_000

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Exclusive-create lock file next to the jobs file; waits briefly if another process holds it. */
function lock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true })
  const lockPath = `${path}.lock`
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      closeSync(openSync(lockPath, "wx"))
      return () => {
        try {
          unlinkSync(lockPath)
        } catch {
          /* already taken over as stale */
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
    }
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) unlinkSync(lockPath)
    } catch {
      /* released meanwhile */
    }
    if (Date.now() > deadline) throw new Error(`jobs file is locked (${lockPath}); if no other jp is running, delete that file`)
    sleepSync(25 + Math.random() * 50)
  }
}

/**
 * Read-modify-write under the lock, on a fresh copy of the jobs file. Every
 * writer goes through this, so a slow scrape can't overwrite a `jp set` made
 * meanwhile. Saves only if `fn` changed something.
 */
export function updateStore<T>(path: string, fn: (store: Store) => T): T {
  const unlock = lock(path)
  try {
    const store = loadStore(path)
    const before = JSON.stringify(store)
    const result = fn(store)
    if (JSON.stringify(store) !== before) saveStore(path, store)
    return result
  } finally {
    unlock()
  }
}

/** True once a job has been applied to, whatever its status now. */
export const everApplied = (j: StoredJob) => Boolean(j.appliedAt) || j.history.some((h) => h.status === "applied")

const now = () => new Date().toISOString()

export interface MergeResult {
  added: StoredJob[]
  known: number
  /** Known jobs already applied to or skipped; listed so a scrape can say so. */
  alreadyDone: number
}

/** Add newly scraped jobs as "new"; for known ones only refresh lastSeen. */
export function mergeScraped(store: Store, jobs: Job[]): MergeResult {
  const result: MergeResult = { added: [], known: 0, alreadyDone: 0 }
  const t = now()
  for (const j of jobs) {
    const existing = store.jobs[j.id]
    if (existing) {
      existing.lastSeen = t
      // An application is never reopened as new, even if its posting comes back.
      if (existing.status === "closed" && !everApplied(existing)) setStatus(existing, "new", "seen again after being closed")
      result.known++
      if (DONE.includes(existing.status)) result.alreadyDone++
      continue
    }
    const stored: StoredJob = { ...j, url: httpUrl(j.url), status: "new", firstSeen: t, lastSeen: t, history: [{ at: t, status: "new" }] }
    store.jobs[j.id] = stored
    result.added.push(stored)
  }
  return result
}

export function setStatus(job: StoredJob, status: Status, note?: string): void {
  job.status = status
  const entry: HistoryEntry = { at: now(), status }
  if (note) entry.note = note
  job.history.push(entry)
  if (status === "applied") job.appliedAt = entry.at
}

/**
 * Moves that would lose track of a real application are refused unless forced:
 * once applied, a job only moves on with --force.
 */
export function canMove(from: Status, to: Status): boolean {
  if (from === to) return true
  if (from === "applied") return false
  return true
}
