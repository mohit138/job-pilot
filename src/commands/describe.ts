import { ADAPTERS } from "../portals/adapters.ts"
import { writeError } from "../portals/helpers.ts"
import { findCompany, loadRegistry, registryPath } from "../portals/registry.ts"
import { loadStore, saveStore, setStatus, STATUSES, storePath, type Status, type StoredJob } from "../store.ts"

export interface DescribeOpts {
  ids: string[]
  statuses: string[]
}

/** Few requests at a time: one portal at a time sees at most this many. */
const CONCURRENCY = 4

/**
 * Fetch and keep each job's full description, so /rank and /apply read it
 * from the jobs file instead of hitting the portal again. A job the portal no
 * longer has is marked closed.
 */
export async function runDescribe(opts: DescribeOpts): Promise<number> {
  const bad = opts.statuses.filter((s) => !STATUSES.includes(s as Status))
  if (bad.length) {
    writeError(`unknown status ${bad.join(", ")}`, "BAD_STATUS")
    return 1
  }
  const path = storePath()
  const store = loadStore(path)
  const registry = loadRegistry(registryPath())
  const targets: StoredJob[] = opts.ids.length
    ? opts.ids.map((id) => store.jobs[id]).filter(Boolean)
    : Object.values(store.jobs).filter((j) => opts.statuses.includes(j.status))
  const todo = targets.filter((j) => !j.description)

  let fetched = 0
  const closed: string[] = []
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
        const d = await ADAPTERS[company.ats].detail(company, j.id.slice(sep + 1))
        if (!d) {
          setStatus(j, "closed", "portal no longer lists it")
          closed.push(j.id)
        } else {
          j.description = d.description ?? ""
          if (!j.location && d.location) j.location = d.location
          fetched++
        }
      } catch (e) {
        failed.push({ id: j.id, error: (e as Error).message })
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  saveStore(path, store)

  process.stdout.write(
    JSON.stringify({ alreadyHad: targets.length - todo.length, fetched, closed, failed }, null, 2) + "\n"
  )
  return failed.length && fetched === 0 && todo.length > 0 ? 1 : 0
}
