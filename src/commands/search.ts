import { ADAPTERS, type Job } from "../portals/adapters.ts"
import { daysAgo, matchesLocation, matchesQuery, writeError } from "../portals/helpers.ts"
import { loadRegistry, registryPath, type Company } from "../portals/registry.ts"

export interface SearchOpts {
  query?: string
  location?: string
  includeRemote: boolean
  companies?: string[]
  jobage?: number
  limit?: number
  maxPerCompany: number
  registry?: string
  format: "json" | "table" | "plain"
}

export interface CompanyStatus {
  company: string
  ats: string
  count: number
  error: string | null
}

export function selectCompanies(all: Company[], names?: string[]): Company[] {
  if (!names?.length) return all.filter((c) => c.enabled)
  const wanted = names.map((n) => n.toLowerCase())
  return all.filter((c) => wanted.includes(c.slug) || wanted.includes(c.name.toLowerCase()))
}

export async function searchCompany(c: Company, opts: Omit<SearchOpts, "format" | "registry" | "companies" | "limit">): Promise<Job[]> {
  const adapter = ADAPTERS[c.ats]
  // Fetch a wider window when filtering happens client-side.
  const clientSide = !adapter.serverQuery || !adapter.serverLocation(c, opts.location)
  const jobs = await adapter.search(c, {
    query: opts.query,
    location: opts.location,
    maxResults: clientSide ? Math.max(opts.maxPerCompany, 200) : opts.maxPerCompany,
  })
  const cutoff = opts.jobage !== undefined ? daysAgo(opts.jobage) : null
  return jobs
    .filter((j) => adapter.serverQuery || matchesQuery(j.title, opts.query))
    .filter((j) => adapter.serverLocation(c, opts.location) || matchesLocation(j.location, opts.location, opts.includeRemote))
    .filter((j) => !cutoff || !j.date || j.date >= cutoff) // undated jobs are kept
    .slice(0, opts.maxPerCompany)
}

function renderTable(jobs: Job[], statuses: CompanyStatus[]): string {
  const lines: string[] = []
  if (jobs.length === 0) lines.push("No results.")
  else {
    const header = `${"COMPANY".padEnd(16)} ${"TITLE".padEnd(48)} ${"LOCATION".padEnd(28)} DATE`
    lines.push(header, "-".repeat(header.length + 6))
    for (const j of jobs) {
      lines.push(
        `${j.company.slice(0, 16).padEnd(16)} ${j.title.slice(0, 48).padEnd(48)} ${(j.location ?? "—").slice(0, 28).padEnd(28)} ${j.date ?? "—"}`
      )
    }
  }
  lines.push("", "Per company: " + statuses.map((s) => `${s.company} ${s.error ? "ERROR" : s.count}`).join(" · "))
  for (const s of statuses.filter((s) => s.error)) lines.push(`  ${s.company}: ${s.error}`)
  return lines.join("\n")
}

function renderPlain(jobs: Job[]): string {
  if (jobs.length === 0) return "No results."
  return jobs
    .map((j) => [`${j.title} — ${j.company}`, `  ${j.location ?? "—"} | ${j.date ?? "date unknown"}`, `  ${j.url}`, `  id: ${j.id}`].join("\n"))
    .join("\n\n")
}

/** Search every company in parallel; one company failing never sinks the rest. */
export async function searchAll(
  companies: Company[],
  opts: Omit<SearchOpts, "format" | "registry" | "companies" | "limit">
): Promise<{ jobs: Job[]; statuses: CompanyStatus[] }> {
  const statuses: CompanyStatus[] = []
  const results = await Promise.all(
    companies.map(async (c) => {
      try {
        const jobs = await searchCompany(c, opts)
        statuses.push({ company: c.name, ats: c.ats, count: jobs.length, error: null })
        return jobs
      } catch (e) {
        statuses.push({ company: c.name, ats: c.ats, count: 0, error: (e as Error).message })
        return []
      }
    })
  )
  // Newest first; undated jobs last.
  const jobs = results.flat().sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
  statuses.sort((a, b) => a.company.localeCompare(b.company))
  return { jobs, statuses }
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const path = registryPath(opts.registry)
  let registry
  try {
    registry = loadRegistry(path)
  } catch (e) {
    writeError((e as Error).message, "REGISTRY_ERROR")
    return 1
  }
  const companies = selectCompanies(registry.companies, opts.companies)
  if (companies.length === 0) {
    writeError(
      registry.companies.length === 0
        ? `No companies registered yet (${path}). Add one with: add --name "<Company>" --url "<careers link>"`
        : `No enabled company matches ${opts.companies?.join(", ") ?? "(all)"} — see 'list'`,
      "NO_COMPANIES"
    )
    return 1
  }

  const found = await searchAll(companies, opts)
  const statuses = found.statuses
  let jobs = found.jobs
  if (opts.limit !== undefined && opts.limit >= 0) jobs = jobs.slice(0, opts.limit)

  if (opts.format === "table") process.stdout.write(renderTable(jobs, statuses) + "\n")
  else if (opts.format === "plain") process.stdout.write(renderPlain(jobs) + "\n")
  else process.stdout.write(JSON.stringify({ meta: { count: jobs.length, page: 1, companies: statuses }, results: jobs }, null, 2) + "\n")

  // Partial failure still exits 0 (results are useful); total failure exits 1.
  if (statuses.every((s) => s.error)) {
    writeError("Every company search failed: " + statuses.map((s) => `${s.company}: ${s.error}`).join("; "), "ALL_FAILED")
    return 1
  }
  return 0
}
