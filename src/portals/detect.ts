// Work out which ATS a careers link uses and the coordinates needed to query it.
// Order: (1) recognise the URL itself, (2) scan the page HTML for ATS links,
// (3) probe Eightfold's API on the same host, (4) look for a job sitemap.

import { jsonFetch, textFetch } from "./helpers.ts"
import type { AtsType } from "./registry.ts"

export interface Detection {
  ats: AtsType
  board: Record<string, string>
  via: string
}

/** Recognise an ATS from a URL alone (no network). */
export function detectFromUrl(raw: string): Detection | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  const seg = u.pathname.split("/").filter(Boolean)
  const q = u.searchParams

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // boards.greenhouse.io/{token}, job-boards.greenhouse.io/{token}, boards-api.greenhouse.io/v1/boards/{token}
    const token = host.startsWith("boards-api") ? seg[2] : q.get("for") ?? seg[0]
    if (token && token !== "embed") return { ats: "greenhouse", board: { token }, via: "url" }
    if (q.get("for")) return { ats: "greenhouse", board: { token: q.get("for")! }, via: "url" }
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    if (seg[0]) return { ats: "lever", board: { company: seg[0] }, via: "url" }
  }
  if (host === "api.lever.co" && seg[0] === "v0" && seg[2]) {
    return { ats: "lever", board: { company: seg[2] }, via: "url" }
  }
  if (host === "jobs.ashbyhq.com" && seg[0]) {
    return { ats: "ashby", board: { name: seg[0] }, via: "url" }
  }
  const wd = host.match(/^([\w-]+)\.(wd\d+)\.myworkdayjobs\.com$/)
  if (wd) {
    // /{site}, /{lang}/{site}, /{site}/job/..., or /wday/cxs/{tenant}/{site}
    let site: string | undefined
    if (seg[0] === "wday" && seg[1] === "cxs") site = seg[3]
    else site = /^[a-z]{2}-[A-Z]{2}$/.test(seg[0] ?? "") ? seg[1] : seg[0]
    if (site) return { ats: "workday", board: { host, tenant: wd[1], site }, via: "url" }
  }
  if (host.endsWith(".oraclecloud.com")) {
    const i = seg.indexOf("sites")
    const siteNumber = i >= 0 ? seg[i + 1] : q.get("siteNumber") ?? undefined
    if (siteNumber) {
      const board: Record<string, string> = { host, siteNumber }
      const locationId = q.get("locationId")
      if (locationId) board.locationId = locationId
      const label = q.get("location")
      if (locationId && label) board.locationLabel = label
      return { ats: "oracle", board, via: "url" }
    }
  }
  return null
}

/** Registrable-ish domain guess: careers.microsoft.com -> microsoft.com, foo.co.in -> foo.co.in */
function baseDomain(host: string): string {
  const parts = host.split(".")
  const twoLevelTlds = ["co.in", "co.uk", "com.au", "co.jp", "com.br", "com.sg"]
  const last2 = parts.slice(-2).join(".")
  return twoLevelTlds.includes(last2) ? parts.slice(-3).join(".") : last2
}

const ATS_LINK_RE =
  /https?:\/\/(?:[\w-]+\.wd\d+\.myworkdayjobs\.com\/[^"'\s<>\\]+|(?:boards|job-boards)\.greenhouse\.io\/[^"'\s<>\\]+|jobs\.(?:eu\.)?lever\.co\/[^"'\s<>\\]+|jobs\.ashbyhq\.com\/[^"'\s<>\\]+|[\w-]+\.fa\.[\w-]+\.oraclecloud\.com\/hcmUI\/[^"'\s<>\\]+)/gi

/** Full detection, including network probes. */
export async function detect(raw: string): Promise<{ detection: Detection | null; tried: string[] }> {
  const tried: string[] = []
  const direct = detectFromUrl(raw)
  if (direct) return { detection: direct, tried: ["url pattern"] }
  tried.push("url pattern")

  const u = new URL(raw)
  const host = u.hostname.toLowerCase()

  // (2) ATS links embedded in the careers page (e.g. Phenom fronts on Workday).
  try {
    const html = await textFetch(raw)
    tried.push("page links")
    if (html) {
      const counts = new Map<string, number>()
      for (const m of html.matchAll(ATS_LINK_RE)) {
        const d = detectFromUrl(m[0].replace(/&amp;/g, "&"))
        if (d) {
          const key = JSON.stringify([d.ats, d.board])
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      if (best) {
        const [ats, board] = JSON.parse(best[0])
        // A page link carries no city filter; drop per-URL hints.
        delete board.locationId
        delete board.locationLabel
        return { detection: { ats, board, via: "link on careers page" }, tried }
      }
    }
  } catch {
    tried.push("page links (fetch failed)")
  }

  // (3) Eightfold PCSX on the same host.
  const domain = u.searchParams.get("domain") ?? baseDomain(host)
  try {
    tried.push("eightfold api")
    const data = await jsonFetch(`https://${host}/api/pcsx/search?domain=${encodeURIComponent(domain)}&start=0`)
    if (Array.isArray(data?.data?.positions)) {
      const board: Record<string, string> = { host, domain }
      const location = u.searchParams.get("location")
      if (location) board.location = location
      return { detection: { ats: "eightfold", board, via: "eightfold api" }, tried }
    }
  } catch {
    /* not eightfold */
  }

  // (4) A sitemap listing /job/ URLs.
  try {
    tried.push("sitemap.xml")
    const sm = `https://${host}/sitemap.xml`
    const xml = await textFetch(sm)
    if (xml && /<loc>[^<]*\/job\/[^<]+<\/loc>/.test(xml)) {
      return { detection: { ats: "sitemap", board: { sitemap: sm }, via: "sitemap.xml" }, tried }
    }
  } catch {
    /* no sitemap */
  }

  return { detection: null, tried }
}
