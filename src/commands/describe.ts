import { ADAPTERS, type JobDetail } from "../portals/adapters.ts"
import { writeError } from "../portals/helpers.ts"
import { findCompany, loadRegistry, registryPath } from "../portals/registry.ts"
import { loadStore, setStatus, STATUSES, storePath, updateStore, type Status, type StoredJob } from "../store.ts"

export interface DescribeOpts {
  ids: string[]
  statuses: string[]
}

/** Workers in flight; the shared fetch path still limits each host to a couple at a time. */
const CONCURRENCY = 4

/** Only jobs still on the way to an application may be closed; an applied or skipped one keeps its status. */
const CLOSABLE: Status[] = ["new", "ranked", "approved"]

/**
 * Fetch and keep each job's full description, so /rank and /apply read it
 * from the jobs file instead of hitting the portal again. A job the portal no
 * longer has is marked closed, unless it is further along than approved.
 * Fetches first, then applies the results to a fresh copy of the jobs file.
 */
export async function runDescribe(opts: DescribeOpts): Promise<number> {
  const bad = opts.statuses.filter((s) => !STATUSES.includes(s as Status))
  if (bad.length) {
    writeError(`unknown status ${bad.join(", ")}`, "BAD_STATUS")
    return 1
  }
  const path = storePath()
  const snapshot = loadStore(path)
  const registry = loadRegistry(registryPath())
  const targets: StoredJob[] = opts.ids.length
    ? opts.ids.map((id) => snapshot.jobs[id]).filter(Boolean)
    : Object.values(snapshot.jobs).filter((j) => opts.statuses.includes(j.status))
  const todo = targets.filter((j) => !j.description)

  const found = new Map<string, JobDetail | null>()
  const failed: { id: string; error: string }[] = []
  const queue = [...todo]
  async function worker() {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const sep = j.id.indexOf(":")
      const company = findCompany(registry, j.id.slice(0, sep))
      if (!company) {
        failed.push({ id: j.id, error: "company no longer in me/companies.json" })
        continue
      }
      try {
        found.set(j.id, await ADAPTERS[company.ats].detail(company, j.id.slice(sep + 1)))
      } catch (e) {
        failed.push({ id: j.id, error: (e as Error).message })
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  let fetched = 0
  const closed: string[] = []
  updateStore(path, (store) => {
    for (const [id, d] of found) {
      const j = store.jobs[id]
      if (!j) continue // removed meanwhile
      if (!d) {
        if (CLOSABLE.includes(j.status)) {
          setStatus(j, "closed", "portal no longer lists it")
          closed.push(id)
        }
        continue
      }
      if (!j.description) j.description = d.description ?? ""
      if (!j.location && d.location) j.location = d.location
      fetched++
    }
  })

  process.stdout.write(
    JSON.stringify({ alreadyHad: targets.length - todo.length, fetched, closed, failed }, null, 2) + "\n"
  )
  return failed.length && fetched === 0 && todo.length > 0 ? 1 : 0
}
