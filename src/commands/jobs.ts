import { writeError } from "../portals/helpers.ts"
import { canMove, loadStore, saveStore, setStatus, STATUSES, storePath, type Status, type StoredJob } from "../store.ts"

export interface JobsOpts {
  statuses?: string[]
  company?: string
  sort: "score" | "date"
  format: "json" | "table"
}

export function runJobs(opts: JobsOpts): number {
  const bad = opts.statuses?.filter((s) => !STATUSES.includes(s as Status))
  if (bad?.length) {
    writeError(`unknown status ${bad.join(", ")}; use one of: ${STATUSES.join(", ")}`, "BAD_STATUS")
    return 1
  }
  const store = loadStore(storePath())
  let jobs = Object.values(store.jobs)
  if (opts.statuses?.length) jobs = jobs.filter((j) => opts.statuses!.includes(j.status))
  if (opts.company) {
    const c = opts.company.toLowerCase()
    jobs = jobs.filter((j) => j.company.toLowerCase() === c || j.id.startsWith(`${c}:`))
  }
  jobs.sort((a, b) =>
    opts.sort === "score"
      ? (b.score ?? -1) - (a.score ?? -1) || (b.date ?? "").localeCompare(a.date ?? "")
      : (b.date ?? "").localeCompare(a.date ?? "")
  )

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify({ count: jobs.length, jobs }, null, 2) + "\n")
    return 0
  }
  const counts = STATUSES.map((s) => [s, Object.values(store.jobs).filter((j) => j.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s} ${n}`)
    .join(" · ")
  const lines = [`${Object.keys(store.jobs).length} jobs in file: ${counts || "none yet"}`, ""]
  if (jobs.length === 0) lines.push("No jobs match.")
  else {
    const header = `${"ID".padEnd(34)} ${"STATUS".padEnd(9)} ${"SCORE".padEnd(5)} ${"COMPANY".padEnd(12)} TITLE`
    lines.push(header, "-".repeat(header.length + 40))
    for (const j of jobs) {
      lines.push(
        `${j.id.slice(0, 34).padEnd(34)} ${j.status.padEnd(9)} ${String(j.score ?? "-").padEnd(5)} ${j.company.slice(0, 12).padEnd(12)} ${j.title.slice(0, 60)}`
      )
    }
  }
  process.stdout.write(lines.join("\n") + "\n")
  return 0
}

export interface SetOpts {
  ids: string[]
  status?: string
  score?: number
  note?: string
  force: boolean
}

export function runSet(opts: SetOpts): number {
  if (opts.status && !STATUSES.includes(opts.status as Status)) {
    writeError(`unknown status ${opts.status}; use one of: ${STATUSES.join(", ")}`, "BAD_STATUS")
    return 1
  }
  if (!opts.status && opts.score === undefined && !opts.note) {
    writeError("set needs --status, --score or --note", "NOTHING_TO_SET")
    return 1
  }
  const path = storePath()
  const store = loadStore(path)
  const missing = opts.ids.filter((id) => !store.jobs[id])
  if (missing.length) {
    writeError(`not in the jobs file: ${missing.join(", ")}`, "UNKNOWN_JOB")
    return 1
  }
  const refused = opts.status && !opts.force ? opts.ids.filter((id) => !canMove(store.jobs[id].status, opts.status as Status)) : []
  if (refused.length) {
    writeError(`already applied, so not moved: ${refused.join(", ")} (add --force if this is really a correction)`, "ALREADY_APPLIED")
    return 1
  }

  const changed: StoredJob[] = []
  for (const id of opts.ids) {
    const j = store.jobs[id]
    if (opts.score !== undefined) j.score = opts.score
    if (opts.status) setStatus(j, opts.status as Status, opts.note)
    else if (opts.note) j.rankNote = opts.note
    if (opts.status === "ranked" && opts.note) j.rankNote = opts.note
    changed.push(j)
  }
  saveStore(path, store)
  process.stdout.write(
    JSON.stringify({ updated: changed.map((j) => ({ id: j.id, status: j.status, score: j.score ?? null })) }, null, 2) + "\n"
  )
  return 0
}
