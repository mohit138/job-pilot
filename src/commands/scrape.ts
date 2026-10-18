import type { Job } from "../portals/adapters.ts"
import { writeError } from "../portals/helpers.ts"
import { loadRegistry, registryPath } from "../portals/registry.ts"
import { excludedByTitle, loadSettings } from "../settings.ts"
import { loadStore, mergeScraped, saveStore, storePath } from "../store.ts"
import { searchAll, selectCompanies, type CompanyStatus } from "./search.ts"

export interface ScrapeOpts {
  companies?: string[]
  format: "json" | "table"
}

/**
 * Run every search query against every enabled company, then merge the
 * results into the jobs file. Only jobs never seen before come back as new.
 */
export async function runScrape(opts: ScrapeOpts): Promise<number> {
  let settings, registry, store
  const path = storePath()
  try {
    settings = loadSettings()
    registry = loadRegistry(registryPath())
    store = loadStore(path)
  } catch (e) {
    writeError((e as Error).message, "CONFIG_ERROR")
    return 1
  }
  const companies = selectCompanies(registry.companies, opts.companies)
  if (companies.length === 0) {
    writeError("No enabled companies. Add one with /add-company (or: bun run jp add --name <Company> --url <careers link>)", "NO_COMPANIES")
    return 1
  }

  const byId = new Map<string, Job>()
  const errors = new Map<string, CompanyStatus>()
  for (const query of settings.queries) {
    const { jobs, statuses } = await searchAll(companies, {
      query,
      location: settings.location,
      includeRemote: settings.includeRemote,
      jobage: settings.jobage,
      maxPerCompany: settings.maxPerCompany,
    })
    for (const j of jobs) byId.set(j.id, j)
    for (const s of statuses) {
      // A company counts as failed only if every query failed for it.
      const prev = errors.get(s.company)
      if (!prev) errors.set(s.company, { ...s })
      else if (!s.error) prev.error = null
    }
  }

  const found = [...byId.values()]
  const kept = found.filter((j) => !excludedByTitle(j.title, settings.excludeTitleWords))
  const merge = mergeScraped(store, kept)
  saveStore(path, store)

  // Per-company counts are unique jobs kept, so they add up to the totals above.
  const statuses = [...errors.values()]
    .map((s) => ({ ...s, count: kept.filter((j) => j.company === s.company).length }))
    .sort((a, b) => a.company.localeCompare(b.company))
  const summary = {
    found: found.length,
    excludedByTitle: found.length - kept.length,
    new: merge.added.length,
    alreadyKnown: merge.known,
    alreadyAppliedOrSkipped: merge.alreadyDone,
    companies: statuses,
    jobsFile: path,
  }
  if (opts.format === "json") {
    process.stdout.write(JSON.stringify({ summary, newJobs: merge.added }, null, 2) + "\n")
  } else {
    const lines = [
      `Found ${summary.found} jobs · ${summary.excludedByTitle} excluded by title · ${summary.new} new · ${summary.alreadyKnown} already known (${summary.alreadyAppliedOrSkipped} applied or skipped)`,
      "Per company: " + statuses.map((s) => `${s.company} ${s.error ? "ERROR" : s.count}`).join(" · "),
      ...statuses.filter((s) => s.error).map((s) => `  ${s.company}: ${s.error}`),
    ]
    if (merge.added.length) {
      lines.push("", "NEW")
      for (const j of merge.added) lines.push(`  ${j.id.padEnd(34)} ${j.company.slice(0, 12).padEnd(12)} ${j.title.slice(0, 60)}`)
    }
    process.stdout.write(lines.join("\n") + "\n")
  }
  if (statuses.every((s) => s.error)) {
    writeError("Every company search failed", "ALL_FAILED")
    return 1
  }
  return 0
}
