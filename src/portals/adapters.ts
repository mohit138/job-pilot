// One adapter per applicant-tracking system. Each knows how to list a
// company's open jobs and fetch one job's description from that ATS's public
// (unauthenticated) job-board endpoints. See ../url-reference.md for details.

import {
  htmlToText,
  jsonFetch,
  locationTerms,
  matchesLocation,
  parseRelativePosted,
  textFetch,
  titleCase,
  toDate,
} from "./helpers.ts"
import type { AtsType, Company } from "./registry.ts"

export interface Job {
  id: string
  title: string
  company: string
  location: string | null
  date: string | null
  url: string
  department: string | null
}

export interface JobDetail extends Job {
  description: string | null
}

export interface SearchParams {
  query?: string
  location?: string
  /** Upper bound on jobs fetched per company (keeps request volume low). */
  maxResults: number
}

export interface Adapter {
  /** True when the ATS applies `query` server-side (relevance search incl. description). */
  serverQuery: boolean
  /** True when the ATS applies the requested `location` server-side. */
  serverLocation: (c: Company, location?: string) => boolean
  /** The URL whose robots.txt governs this source (checked when a company is added). */
  policyUrl(c: Company): string
  search(c: Company, p: SearchParams): Promise<Job[]>
  detail(c: Company, jobId: string): Promise<JobDetail | null>
}

const job = (c: Company, id: string | number, fields: Omit<Job, "id" | "company">): Job => ({
  id: `${c.slug}:${id}`,
  company: c.name,
  ...fields,
})

// ---------------------------------------------------------------------------
// Greenhouse — boards-api.greenhouse.io/v1/boards/{token}/jobs

const greenhouse: Adapter = {
  serverQuery: false,
  serverLocation: () => false,
  policyUrl: (c) => `https://boards-api.greenhouse.io/v1/boards/${c.board.token}/jobs`,
  async search(c) {
    const data = await jsonFetch(`https://boards-api.greenhouse.io/v1/boards/${c.board.token}/jobs`)
    return (data?.jobs ?? []).map((j: any) =>
      job(c, j.id, {
        title: j.title,
        location: j.location?.name ?? null,
        date: toDate(j.first_published ?? j.updated_at),
        url: j.absolute_url,
        department: null,
      })
    )
  },
  async detail(c, id) {
    const j = await jsonFetch(`https://boards-api.greenhouse.io/v1/boards/${c.board.token}/jobs/${id}`)
    if (!j) return null
    return {
      ...job(c, j.id, {
        title: j.title,
        location: j.location?.name ?? null,
        date: toDate(j.first_published ?? j.updated_at),
        url: j.absolute_url,
        department: j.departments?.[0]?.name ?? null,
      }),
      description: htmlToText(j.content),
    }
  },
}

// ---------------------------------------------------------------------------
// Lever — api.lever.co/v0/postings/{company}

const leverJob = (c: Company, j: any): Job =>
  job(c, j.id, {
    title: j.text,
    location: j.categories?.allLocations?.join(" / ") ?? j.categories?.location ?? null,
    date: toDate(j.createdAt),
    url: j.hostedUrl,
    department: j.categories?.team ?? j.categories?.department ?? null,
  })

const lever: Adapter = {
  serverQuery: false,
  serverLocation: () => false,
  policyUrl: (c) => `https://api.lever.co/v0/postings/${c.board.company}`,
  async search(c) {
    const data = await jsonFetch(`https://api.lever.co/v0/postings/${c.board.company}?mode=json`)
    return Array.isArray(data) ? data.map((j) => leverJob(c, j)) : []
  },
  async detail(c, id) {
    const j = await jsonFetch(`https://api.lever.co/v0/postings/${c.board.company}/${id}?mode=json`)
    if (!j || j.ok === false) return null
    const lists = (j.lists ?? [])
      .map((l: any) => `${l.text}\n${htmlToText(l.content) ?? ""}`)
      .join("\n\n")
    return {
      ...leverJob(c, j),
      description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n").trim() || null,
    }
  },
}

// ---------------------------------------------------------------------------
// Ashby — api.ashbyhq.com/posting-api/job-board/{name}

const ashbyJob = (c: Company, j: any): Job =>
  job(c, j.id, {
    title: j.title,
    location: [j.location, ...(j.secondaryLocations ?? []).map((s: any) => s.location)].filter(Boolean).join(" / ") || null,
    date: toDate(j.publishedAt),
    url: j.jobUrl,
    department: j.department ?? null,
  })

const ashby: Adapter = {
  serverQuery: false,
  serverLocation: () => false,
  policyUrl: (c) => `https://api.ashbyhq.com/posting-api/job-board/${c.board.name}`,
  async search(c) {
    const data = await jsonFetch(`https://api.ashbyhq.com/posting-api/job-board/${c.board.name}`)
    return (data?.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => ashbyJob(c, j))
  },
  async detail(c, id) {
    const data = await jsonFetch(`https://api.ashbyhq.com/posting-api/job-board/${c.board.name}`)
    const j = (data?.jobs ?? []).find((x: any) => x.id === id)
    if (!j) return null
    return { ...ashbyJob(c, j), description: j.descriptionPlain ?? htmlToText(j.descriptionHtml) }
  },
}

// ---------------------------------------------------------------------------
// JSON feed — a company's own careers site that loads its job list from a
// first-party JSON file (common for custom SPA career sites, e.g. Swiggy's
// careers.swiggy.in/api/jobs.json). Field names are mapped in the registry:
// board.url, board.items (dot path to the array; auto if omitted), board.title,
// board.location, board.date, board.link, board.id, board.department.

function getPath(obj: any, path: string | undefined): any {
  if (!path) return undefined
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function feedItems(data: any, path: string | undefined): any[] {
  const v = path ? getPath(data, path) : Array.isArray(data) ? data : Object.values(data ?? {}).find(Array.isArray)
  return Array.isArray(v) ? v : []
}

const feedJob = (c: Company, j: any, index: number): Job => {
  const link = String(getPath(j, c.board.link) ?? "")
  return job(c, getPath(j, c.board.id) ?? link.match(/(\d{6,})/)?.[1] ?? index, {
    title: String(getPath(j, c.board.title) ?? ""),
    location: getPath(j, c.board.location) ?? null,
    date: toDate(getPath(j, c.board.date)),
    url: link,
    department: getPath(j, c.board.department) ?? null,
  })
}

const jsonfeed: Adapter = {
  serverQuery: false,
  serverLocation: () => false,
  policyUrl: (c) => c.board.url,
  async search(c) {
    const data = await jsonFetch(c.board.url)
    return feedItems(data, c.board.items)
      .map((j, i) => feedJob(c, j, i))
      .filter((j) => j.title && j.url)
  },
  async detail(c, id) {
    const all = await jsonfeed.search(c, { maxResults: Infinity })
    const base = all.find((j) => j.id === `${c.slug}:${id}`)
    return base ? pageDetail(base) : null
  },
}

/** Fetch a job page and extract its description, preferring schema.org JobPosting JSON-LD. */
async function pageDetail(base: Job): Promise<JobDetail | null> {
  const html = await textFetch(base.url)
  if (!html) return null
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const ld = JSON.parse(m[1])
      const jp = [ld, ...(ld["@graph"] ?? [])].find((x: any) => x?.["@type"] === "JobPosting")
      if (jp) {
        const addr = [jp.jobLocation].flat()[0]?.address
        return {
          ...base,
          title: jp.title ?? base.title,
          date: toDate(jp.datePosted) ?? base.date,
          location: addr ? [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ") : base.location,
          description: htmlToText(jp.description),
        }
      }
    } catch {
      /* malformed JSON-LD: fall through to page text */
    }
  }
  // schema.org microdata (e.g. SmartRecruiters job pages): itemprop="description" ... "incentives".
  const props = [...html.matchAll(/<[^>]+itemprop="(description|responsibilities|qualifications|incentives)"[^>]*>/g)]
  if (props.length) {
    const start = props[0].index!
    const last = props[props.length - 1].index!
    const end = html.indexOf("</section>", last)
    const datePosted = html.match(/itemprop="datePosted"[^>]*content="([^"]+)"/)?.[1]
    return {
      ...base,
      date: toDate(datePosted) ?? base.date,
      description: htmlToText(html.slice(start, end > last ? end : undefined)),
    }
  }
  return { ...base, description: htmlToText(html) }
}

// ---------------------------------------------------------------------------
// Workday — POST https://{host}/wday/cxs/{tenant}/{site}/jobs

const wdBase = (c: Company) => `https://${c.board.host}/wday/cxs/${c.board.tenant}/${c.board.site}`

/** Find Workday location facet ids whose label matches the requested city. */
function workdayLocationFacets(facets: any[], location: string): Record<string, string[]> {
  const terms = locationTerms(location)
  const applied: Record<string, string[]> = {}
  const visit = (f: any) => {
    for (const v of f.values ?? []) {
      if (v.facetParameter) visit(v)
      else if (/location/i.test(f.facetParameter ?? "") && terms.some((t) => (v.descriptor ?? "").toLowerCase().includes(t))) {
        ;(applied[f.facetParameter] ??= []).push(v.id)
      }
    }
  }
  facets.forEach(visit)
  // Prefer the most specific facet (city-level "locations") when present.
  if (applied.locations) return { locations: applied.locations }
  return applied
}

const workday: Adapter = {
  serverQuery: true,
  serverLocation: () => true,
  policyUrl: (c) => `${wdBase(c)}/jobs`,
  async search(c, p) {
    const url = `${wdBase(c)}/jobs`
    const searchText = p.query ?? ""
    let appliedFacets: Record<string, string[]> = {}
    if (p.location) {
      const probe = await jsonFetch(url, { method: "POST", body: { appliedFacets: {}, limit: 1, offset: 0, searchText } })
      appliedFacets = workdayLocationFacets(probe?.facets ?? [], p.location)
      // No facet matched the city: return nothing rather than every location worldwide.
      if (Object.keys(appliedFacets).length === 0) return []
    }
    const out: Job[] = []
    const pageSize = 20 // Workday's maximum
    for (let offset = 0; offset < p.maxResults; offset += pageSize) {
      const data = await jsonFetch(url, { method: "POST", body: { appliedFacets, limit: pageSize, offset, searchText } })
      const postings = data?.jobPostings ?? []
      for (const j of postings) {
        if (!j.externalPath) continue
        out.push(
          job(c, j.externalPath, {
            title: j.title,
            location: j.locationsText ?? null,
            date: parseRelativePosted(j.postedOn),
            url: `https://${c.board.host}/${c.board.site}${j.externalPath}`,
            department: null,
          })
        )
      }
      if (postings.length < pageSize || offset + pageSize >= (data?.total ?? 0)) break
    }
    return out
  },
  async detail(c, path) {
    const data = await jsonFetch(`${wdBase(c)}${path}`)
    const j = data?.jobPostingInfo
    if (!j) return null
    return {
      ...job(c, path, {
        title: j.title,
        location: j.location ?? null,
        date: toDate(j.startDate) ?? parseRelativePosted(j.postedOn),
        url: j.externalUrl ?? `https://${c.board.host}/${c.board.site}${path}`,
        department: null,
      }),
      description: htmlToText(j.jobDescription),
    }
  },
}

// ---------------------------------------------------------------------------
// Eightfold (PCSX) — GET https://{host}/api/pcsx/search?domain=...

const eightfoldJob = (c: Company, j: any): Job =>
  job(c, j.id, {
    title: j.name,
    location: (j.locations ?? []).join(" / ") || null,
    date: toDate(j.postedTs ?? j.creationTs),
    url: `https://${c.board.host}${j.positionUrl ?? `/careers/job/${j.id}`}`,
    department: j.department ?? null,
  })

/** A location pinned in the registry is usable when no city was requested or it is the same city. */
function pinnedLocationFits(pinned: string | undefined, requested: string | undefined): boolean {
  if (!pinned) return false
  return !requested || matchesLocation(pinned, requested, false)
}

const eightfold: Adapter = {
  serverQuery: true,
  serverLocation: () => true,
  policyUrl: (c) => `https://${c.board.host}/api/pcsx/search`,
  async search(c, p) {
    const out: Job[] = []
    const pageSize = 10 // fixed by the API
    // The registry may pin the ATS's own location string (e.g. "India, Karnataka, Bangalore");
    // use it unless the caller asked for a different city.
    const location = pinnedLocationFits(c.board.location, p.location) ? c.board.location ?? p.location : p.location
    for (let start = 0; start < p.maxResults; start += pageSize) {
      const qs = new URLSearchParams({ domain: c.board.domain, start: String(start), sort_by: "timestamp" })
      if (p.query) qs.set("query", p.query)
      if (location) qs.set("location", location)
      const data = await jsonFetch(`https://${c.board.host}/api/pcsx/search?${qs}`)
      const positions = data?.data?.positions ?? []
      out.push(...positions.map((j: any) => eightfoldJob(c, j)))
      if (positions.length < pageSize || start + pageSize >= (data?.data?.count ?? 0)) break
    }
    return out
  },
  async detail(c, id) {
    const qs = new URLSearchParams({ position_id: id, domain: c.board.domain, hl: "en" })
    const data = await jsonFetch(`https://${c.board.host}/api/pcsx/position_details?${qs}`)
    const j = data?.data
    if (!j) return null
    return { ...eightfoldJob(c, j), description: htmlToText(j.jobDescription) }
  },
}

// ---------------------------------------------------------------------------
// Oracle HCM Cloud Candidate Experience — /hcmRestApi/resources/latest/recruitingCEJobRequisitions

const oracleJobUrl = (c: Company, id: string) =>
  `https://${c.board.host}/hcmUI/CandidateExperience/en/sites/${c.board.siteNumber}/job/${id}`

// locationId is only meaningful for the city it was copied from (board.locationLabel).
const oracleUsePin = (c: Company, location?: string) =>
  !location || !c.board.locationLabel || matchesLocation(c.board.locationLabel, location, false)

const oracle: Adapter = {
  serverQuery: true,
  serverLocation: (c, location) => Boolean(c.board.locationId) && oracleUsePin(c, location),
  policyUrl: (c) => `https://${c.board.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`,
  async search(c, p) {
    const out: Job[] = []
    const pageSize = 25
    for (let offset = 0; offset < p.maxResults; offset += pageSize) {
      const finder = [
        `siteNumber=${c.board.siteNumber}`,
        `limit=${pageSize}`,
        `offset=${offset}`,
        "sortBy=POSTING_DATES_DESC",
        p.query ? `keyword="${p.query.replace(/"/g, "")}"` : null,
        c.board.locationId && oracleUsePin(c, p.location) ? `locationId=${c.board.locationId}` : null,
      ]
        .filter(Boolean)
        .join(",")
      const url =
        `https://${c.board.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
        `?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;${encodeURIComponent(finder)}`
      const data = await jsonFetch(url)
      const item = data?.items?.[0]
      const reqs = item?.requisitionList ?? []
      for (const r of reqs) {
        const secondary = (r.secondaryLocations ?? []).map((s: any) => s.Name).filter(Boolean)
        out.push(
          job(c, r.Id, {
            title: r.Title,
            location: [r.PrimaryLocation, ...secondary].filter(Boolean).join(" / ") || null,
            date: toDate(r.PostedDate),
            url: oracleJobUrl(c, r.Id),
            department: r.Organization ?? null,
          })
        )
      }
      if (reqs.length < pageSize || offset + pageSize >= (item?.TotalJobsCount ?? 0)) break
    }
    return out
  },
  async detail(c, id) {
    const url =
      `https://${c.board.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
      `?expand=all&onlyData=true&finder=ById;${encodeURIComponent(`Id="${id}",siteNumber=${c.board.siteNumber}`)}`
    const data = await jsonFetch(url)
    const r = data?.items?.[0]
    if (!r) return null
    const description = ["ExternalDescriptionStr", "ExternalResponsibilitiesStr", "ExternalQualificationsStr", "CorporateDescriptionStr"]
      .map((k) => htmlToText(r[k]))
      .filter(Boolean)
      .join("\n\n")
    return {
      ...job(c, r.Id, {
        title: r.Title,
        location: r.PrimaryLocation ?? null,
        date: toDate(r.ExternalPostedStartDate ?? r.PostedDate),
        url: oracleJobUrl(c, r.Id),
        department: r.Organization ?? null,
      }),
      description: description || null,
    }
  },
}

// ---------------------------------------------------------------------------
// Sitemap — career sites (e.g. Radancy/TalentBrew) whose search pages are
// robots-disallowed but whose sitemap.xml lists every job URL.
// board.sitemap = sitemap URL, board.jobPattern = regex with named groups
// (?<location>...) and (?<slug>...) and (?<id>...) matched against each URL.

const DEFAULT_JOB_PATTERN = "/job/(?<location>[^/]+)/(?<slug>[^/]+)/\\d+/(?<id>\\d+)"

async function sitemapUrls(url: string, depth = 0): Promise<string[]> {
  const xml = await textFetch(url)
  if (!xml) return []
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
  if (/<sitemapindex/i.test(xml) && depth < 1) {
    const nested = await Promise.all(locs.slice(0, 20).map((l) => sitemapUrls(l, depth + 1)))
    return nested.flat()
  }
  return locs
}

const sitemap: Adapter = {
  serverQuery: false,
  serverLocation: () => false,
  policyUrl: (c) => c.board.sitemap,
  async search(c) {
    const re = new RegExp(c.board.jobPattern ?? DEFAULT_JOB_PATTERN)
    const out: Job[] = []
    for (const u of await sitemapUrls(c.board.sitemap)) {
      const m = re.exec(u)
      if (!m?.groups) continue
      out.push(
        job(c, m.groups.id ?? u, {
          title: titleCase(decodeURIComponent(m.groups.slug ?? "")),
          location: m.groups.location ? titleCase(decodeURIComponent(m.groups.location)) : null,
          date: null, // sitemap <lastmod> is the generation time, not the posting date
          url: u,
          department: null,
        })
      )
    }
    return out
  },
  async detail(c, id) {
    const all = await sitemap.search(c, { maxResults: Infinity })
    const base = all.find((j) => j.id === `${c.slug}:${id}`)
    return base ? pageDetail(base) : null
  },
}

export const ADAPTERS: Record<AtsType, Adapter> = {
  greenhouse,
  lever,
  ashby,
  jsonfeed,
  workday,
  eightfold,
  oracle,
  sitemap,
}
