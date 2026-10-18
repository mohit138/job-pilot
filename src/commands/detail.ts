import { ADAPTERS } from "../portals/adapters.ts"
import { writeError } from "../portals/helpers.ts"
import { findCompany, loadRegistry, registryPath } from "../portals/registry.ts"

export interface DetailOpts {
  /** "<company-slug>:<job-id>" as printed by `search`. */
  id: string
  registry?: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const sep = opts.id.indexOf(":")
  if (sep <= 0) {
    writeError(`expected an id of the form <company>:<job-id> (as printed by 'search'), got "${opts.id}"`, "BAD_ID")
    return 1
  }
  const slug = opts.id.slice(0, sep)
  const jobId = opts.id.slice(sep + 1)
  const company = findCompany(loadRegistry(registryPath(opts.registry)), slug)
  if (!company) {
    writeError(`company "${slug}" is not in the registry — see 'list'`, "UNKNOWN_COMPANY")
    return 1
  }
  try {
    const d = await ADAPTERS[company.ats].detail(company, jobId)
    if (!d) {
      writeError(`job ${opts.id} not found (it may have been closed)`, "NOT_FOUND")
      return 1
    }
    if (opts.format === "plain") {
      process.stdout.write(
        [`${d.title} — ${d.company}`, `Location: ${d.location ?? "—"}`, `Posted: ${d.date ?? "unknown"}`, `URL: ${d.url}`, "", d.description ?? "(no description)"].join("\n") + "\n"
      )
    } else {
      process.stdout.write(JSON.stringify(d, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError((e as Error).message, "FETCH_FAILED")
    return 1
  }
}
