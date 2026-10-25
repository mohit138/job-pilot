// `jp apply`: the bookkeeping half of /apply. Claude fills what it knows in the
// user's Chrome and hands the form over; the user fills the rest and submits.
// This hands out one approved job at a time and records each step, so the board
// shows live progress and an interrupted run picks up where it left off.
// Nothing here touches a portal or submits anything.

import { existsSync } from "fs"
import { resolve } from "path"
import { writeError } from "../portals/helpers.ts"
import { loadRegistry, registryPath, type AtsType, type Company } from "../portals/registry.ts"
import { mePath } from "../paths.ts"
import { boardOrigin, demoJob, DEMO_ID, isDemo } from "./demo.ts"
import { setStatus, storePath, updateStore, type Store, type StoredJob } from "../store.ts"

export const APPLY_ACTIONS = ["queue", "next", "demo", "step", "done", "fail", "later"] as const
export type ApplyAction = (typeof APPLY_ACTIONS)[number]

export interface ApplyOpts {
  action: ApplyAction
  id?: string
  note?: string
}

/** Hiring systems whose forms /apply can usually fill end to end. Others tend to need the user for sign-in. */
export const EASY_ATS: AtsType[] = ["greenhouse", "lever", "ashby"]

/**
 * Where the application form lives. Company career sites often wrap the ATS
 * form in their own page, so go to the ATS directly when it has a fixed address.
 * Greenhouse: the embed address, because a board page may redirect to the
 * company's site (Stripe does), where the form sits in a frame the browser tools can't read.
 */
export function applyUrl(job: Pick<StoredJob, "id" | "url">, company?: Company): string {
  const rawId = job.id.slice(job.id.indexOf(":") + 1)
  const base = job.url.replace(/\/+$/, "")
  switch (company?.ats) {
    case "greenhouse":
      return company.board.token ? `https://job-boards.greenhouse.io/embed/job_app?for=${company.board.token}&token=${rawId}` : job.url
    case "lever":
      return base.endsWith("/apply") ? base : `${base}/apply`
    case "ashby":
      return base.endsWith("/application") ? base : `${base}/application`
    default:
      return job.url
  }
}

/** What to expect before the form, per ATS. Shown to Claude with each job. */
const GATES: Partial<Record<AtsType, string>> = {
  workday: "Workday asks you to sign in or create an account before the form. The user does that; wait until they say they're in.",
  oracle: "Oracle asks for an email, terms and a one-time code before the form. The user does all of that; wait until they say they're in.",
  eightfold: "Eightfold may offer 'apply with LinkedIn' or a sign-in; use the plain form, or hand sign-in to the user.",
}

/** The job /apply should work on: one already in progress first (resume it), else the best approved. */
export function pickNext(store: Store): { job: StoredJob; resumed: boolean } | null {
  const jobs = Object.values(store.jobs).filter((j) => !isDemo(j.id))
  const inProgress = jobs.find((j) => j.status === "applying")
  if (inProgress) return { job: inProgress, resumed: true }
  const approved = jobs.filter((j) => j.status === "approved").sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  return approved[0] ? { job: approved[0], resumed: false } : null
}

function companyOf(id: string): Company | undefined {
  const slug = id.slice(0, id.indexOf(":"))
  return loadRegistry(registryPath()).companies.find((c) => c.slug === slug)
}

const out = (data: unknown) => process.stdout.write(JSON.stringify(data, null, 2) + "\n")

/** What /apply needs to work on one job. */
function brief(store: Store, job: StoredJob, resumed: boolean) {
  const company = companyOf(job.id)
  const ats = isDemo(job.id) ? "greenhouse" : company?.ats
  // Absolute paths: the browser's file upload needs one, and JOB_PILOT_HOME may be relative.
  const files = { answers: resolve(mePath("answers.md")), profile: resolve(mePath("profile.md")), resume: resolve(mePath("resume.pdf")) }
  return {
    job: { id: job.id, title: job.title, company: job.company, location: job.location, score: job.score ?? null },
    resumed,
    lastStep: resumed ? job.history.at(-1)?.note ?? null : null,
    ats: ats ?? null,
    supported: !!ats && EASY_ATS.includes(ats),
    applyUrl: isDemo(job.id) ? job.url : applyUrl(job, company),
    jobUrl: job.url,
    gate: (ats && GATES[ats]) ?? null,
    files,
    missingFiles: Object.entries(files).filter(([, p]) => !existsSync(p)).map(([k]) => k),
    remaining: Object.values(store.jobs).filter((j) => j.status === "approved").length,
  }
}

/** Every action runs on one fresh read of the jobs file, under its lock. */
export function runApply(opts: ApplyOpts): number {
  return updateStore(storePath(), (store) => applyAction(store, opts))
}

function applyAction(store: Store, opts: ApplyOpts): number {
  if (opts.action === "queue") {
    const jobs = Object.values(store.jobs)
    const slim = (j: StoredJob) => ({ id: j.id, title: j.title, company: j.company, score: j.score ?? null, last: j.history.at(-1)?.note ?? null })
    out({
      applying: jobs.filter((j) => j.status === "applying").map(slim),
      approved: jobs.filter((j) => j.status === "approved").sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map(slim),
    })
    return 0
  }

  if (opts.action === "next") {
    const picked = pickNext(store)
    if (!picked) {
      out({ job: null, message: "No approved jobs left. Approve some on the board or with /jobs." })
      return 0
    }
    const { job, resumed } = picked
    if (!resumed) {
      setStatus(job, "applying", "Opening the application")
    }
    out(brief(store, job, resumed))
    return 0
  }

  if (opts.action === "demo") {
    // A fresh practice job each time, pointing at the board's demo form.
    const job = demoJob(boardOrigin())
    store.jobs[DEMO_ID] = job
    out(brief(store, job, false))
    return 0
  }

  // step | done | fail | later: all act on the one job being applied to.
  const job = opts.id ? store.jobs[opts.id] : undefined
  if (!opts.id || !job) {
    writeError(opts.id ? `not in the jobs file: ${opts.id}` : `apply ${opts.action} needs a job id`, opts.id ? "UNKNOWN_JOB" : "NO_ID")
    return 1
  }
  if (job.status !== "applying") {
    writeError(`${job.id} is ${job.status}, not applying; start it with 'jp apply next'`, "NOT_APPLYING")
    return 1
  }
  if ((opts.action === "step" || opts.action === "fail") && !opts.note) {
    writeError(`apply ${opts.action} needs --note "<what happened>"`, "NO_NOTE")
    return 1
  }
  // A practice job leaves no trace once it's over.
  if (isDemo(job.id) && opts.action !== "step") {
    delete store.jobs[job.id]
    out({ id: job.id, removed: true, note: "Practice run over" })
    return 0
  }
  const next = { step: "applying", done: "applied", fail: "failed", later: "approved" } as const
  const fallback = { done: "You submitted it", later: "Put back in the queue" } as Record<string, string>
  setStatus(job, next[opts.action], opts.note ?? fallback[opts.action])
  out({ id: job.id, status: job.status, note: job.history.at(-1)?.note })
  return 0
}
