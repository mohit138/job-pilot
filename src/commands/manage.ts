import { ADAPTERS } from "../portals/adapters.ts"
import { detect, type Detection } from "../portals/detect.ts"
import { checkRobots } from "../portals/robots.ts"
import { matchesLocation, matchesQuery, slugify, writeError } from "../portals/helpers.ts"
import {
  ATS_TYPES,
  findCompany,
  loadRegistry,
  registryPath,
  saveRegistry,
  type AtsType,
  type Company,
} from "../portals/registry.ts"

export interface AddOpts {
  name: string
  url: string
  ats?: string
  /** "key=value,key=value" ATS coordinates, used with --ats to skip detection. */
  board?: string
  location?: string
  query?: string
  dryRun: boolean
  force: boolean
  notes?: string
  registry?: string
}

const REQUIRED_BOARD_KEYS: Record<AtsType, string[]> = {
  greenhouse: ["token"],
  lever: ["company"],
  ashby: ["name"],
  jsonfeed: ["url", "title", "link"],
  workday: ["host", "tenant", "site"],
  eightfold: ["host", "domain"],
  oracle: ["host", "siteNumber"],
  sitemap: ["sitemap"],
}

function parseBoard(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of s.split(",")) {
    const i = pair.indexOf("=")
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
  }
  return out
}

export async function runAdd(opts: AddOpts): Promise<number> {
  const path = registryPath(opts.registry)
  let detection: Detection | null
  let tried: string[] = []

  if (opts.ats) {
    if (!ATS_TYPES.includes(opts.ats as AtsType)) {
      writeError(`--ats must be one of: ${ATS_TYPES.join(", ")}`, "BAD_ATS")
      return 1
    }
    const board = parseBoard(opts.board ?? "")
    const missing = REQUIRED_BOARD_KEYS[opts.ats as AtsType].filter((k) => !board[k])
    if (missing.length) {
      writeError(`--ats ${opts.ats} needs --board with: ${missing.join(", ")} (e.g. --board "${missing.map((k) => `${k}=...`).join(",")}")`, "MISSING_BOARD")
      return 1
    }
    detection = { ats: opts.ats as AtsType, board, via: "explicit --ats" }
  } else {
    try {
      ;({ detection, tried } = await detect(opts.url))
    } catch (e) {
      writeError(`could not read ${opts.url}: ${(e as Error).message}`, "FETCH_FAILED")
      return 1
    }
    if (!detection) {
      writeError(
        `could not detect a supported job system for ${opts.name} (tried: ${tried.join(", ")}). ` +
          `Inspect the careers page for the underlying ATS (network calls / JS bundle / apply links), then re-run with --ats <${ATS_TYPES.join("|")}> --board "key=value,..."`,
        "UNSUPPORTED"
      )
      return 1
    }
  }

  const company: Company = {
    name: opts.name,
    slug: slugify(opts.name),
    ats: detection.ats,
    board: detection.board,
    careersUrl: opts.url,
    enabled: true,
    addedAt: new Date().toISOString().slice(0, 10),
    ...(opts.notes ? { notes: opts.notes } : {}),
  }

  const adapter = ADAPTERS[company.ats]

  // robots.txt gate: a site that has said no is never added, --force or not.
  const robots = await checkRobots(adapter.policyUrl(company))
  if (!robots.allowed) {
    process.stdout.write(
      JSON.stringify({ status: "blocked", company: company.name, ats: company.ats, board: company.board, robots }, null, 2) + "\n"
    )
    writeError(`${company.name}: ${robots.reason} (${robots.robotsUrl}) — not added`, "ROBOTS_DISALLOWED")
    return 1
  }

  // Live test: never register a source that has not returned real jobs.
  let total = 0
  let matching: { title: string; location: string | null; date: string | null; url: string }[] = []
  let testError: string | null = null
  try {
    const jobs = await adapter.search(company, { query: opts.query, location: opts.location, maxResults: 40 })
    total = jobs.length
    matching = jobs
      .filter((j) => adapter.serverQuery || matchesQuery(j.title, opts.query))
      .filter((j) => adapter.serverLocation(company, opts.location) || matchesLocation(j.location, opts.location, false))
  } catch (e) {
    testError = (e as Error).message
  }

  const ok = !testError && (total > 0 || opts.force)
  const reg = loadRegistry(path)
  const existing = findCompany(reg, company.slug)
  if (ok && !opts.dryRun) {
    reg.companies = reg.companies.filter((c) => c.slug !== company.slug)
    reg.companies.push(company)
    saveRegistry(path, reg)
  }

  const report = {
    status: !ok ? "failed" : opts.dryRun ? "dry-run" : existing ? "updated" : "added",
    company: company.name,
    slug: company.slug,
    ats: company.ats,
    detectedVia: detection.via,
    board: company.board,
    robots: robots.reason,
    test: {
      query: opts.query ?? null,
      location: opts.location ?? null,
      jobsFetched: total,
      matching: matching.length,
      sample: matching.slice(0, 5),
      error: testError,
    },
    registry: path,
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n")
  if (!ok) {
    writeError(
      testError
        ? `test search failed for ${company.name}: ${testError}`
        : `test search for ${company.name} returned 0 jobs — not registered (use --force to add anyway)`,
      "TEST_FAILED"
    )
    return 1
  }
  return 0
}

export function runList(registry?: string, format: "json" | "table" = "table"): number {
  const path = registryPath(registry)
  const reg = loadRegistry(path)
  if (format === "json") {
    process.stdout.write(JSON.stringify({ registry: path, count: reg.companies.length, companies: reg.companies }, null, 2) + "\n")
    return 0
  }
  if (reg.companies.length === 0) {
    process.stdout.write(`No companies registered (${path}).\n`)
    return 0
  }
  // One block per company: what the user gave us, and the exact feed this tool reads.
  const blocks = reg.companies.map((c) =>
    [
      `${c.name} (${c.slug})  —  ${c.ats}${c.enabled ? "" : "  [DISABLED]"}  — added ${c.addedAt}`,
      `  careers link : ${c.careersUrl}`,
      `  feed searched: ${ADAPTERS[c.ats].policyUrl(c)}`,
      ...(c.notes ? [`  notes        : ${c.notes}`] : []),
    ].join("\n")
  )
  process.stdout.write(blocks.join("\n\n") + `\n\n${reg.companies.length} companies · registry: ${path}\n`)
  return 0
}

export function runSetState(name: string, action: "remove" | "enable" | "disable", registry?: string): number {
  const path = registryPath(registry)
  const reg = loadRegistry(path)
  const c = findCompany(reg, name)
  if (!c) {
    writeError(`company "${name}" is not in the registry — see 'list'`, "UNKNOWN_COMPANY")
    return 1
  }
  if (action === "remove") reg.companies = reg.companies.filter((x) => x !== c)
  else c.enabled = action === "enable"
  saveRegistry(path, reg)
  process.stdout.write(JSON.stringify({ status: action === "remove" ? "removed" : `${action}d`, company: c.name }) + "\n")
  return 0
}
