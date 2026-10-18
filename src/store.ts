// The jobs file (me/jobs.json): every job Job Pilot has ever seen, with its
// status. It is the memory that stops re-scraping, re-ranking and re-applying.
// Keyed by "<company-slug>:<portal job id>", which is stable per posting.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { dirname } from "path"
import type { Job } from "./portals/adapters.ts"
import { mePath } from "./paths.ts"

export const STATUSES = ["new", "ranked", "approved", "applying", "applied", "skipped", "failed", "closed"] as const
export type Status = (typeof STATUSES)[number]

/** Statuses that are final: scrape never resets them and apply never touches them. */
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
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n")
  renameSync(tmp, path)
}

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
      if (existing.status === "closed") setStatus(existing, "new", "seen again after being closed")
      result.known++
      if (DONE.includes(existing.status)) result.alreadyDone++
      continue
    }
    const stored: StoredJob = { ...j, status: "new", firstSeen: t, lastSeen: t, history: [{ at: t, status: "new" }] }
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
