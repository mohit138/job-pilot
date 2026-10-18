// The per-user company registry: which companies to search and how.
// Lives in the private me/ folder so the code stays shareable while each
// person keeps their own list.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname } from "path"
import { mePath } from "../paths.ts"

export type AtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "jsonfeed"
  | "workday"
  | "eightfold"
  | "oracle"
  | "sitemap"

export const ATS_TYPES: AtsType[] = [
  "greenhouse",
  "lever",
  "ashby",
  "jsonfeed",
  "workday",
  "eightfold",
  "oracle",
  "sitemap",
]

export interface Company {
  /** Display name, e.g. "Microsoft". */
  name: string
  /** Stable key used in job ids, e.g. "microsoft". */
  slug: string
  ats: AtsType
  /** ATS-specific coordinates (board token, tenant/site, host, siteNumber, ...). */
  board: Record<string, string>
  /** The careers link the user gave; kept for reference and re-detection. */
  careersUrl: string
  enabled: boolean
  addedAt: string
  notes?: string
}

export interface Registry {
  version: 1
  companies: Company[]
}

export function registryPath(override?: string): string {
  return override ?? mePath("companies.json")
}

export function loadRegistry(path: string): Registry {
  if (!existsSync(path)) return { version: 1, companies: [] }
  const data = JSON.parse(readFileSync(path, "utf8"))
  if (!Array.isArray(data.companies)) throw new Error(`Malformed registry at ${path}: missing "companies" array`)
  return { version: 1, companies: data.companies }
}

export function saveRegistry(path: string, reg: Registry): void {
  mkdirSync(dirname(path), { recursive: true })
  reg.companies.sort((a, b) => a.name.localeCompare(b.name))
  writeFileSync(path, JSON.stringify(reg, null, 2) + "\n")
}

export function findCompany(reg: Registry, nameOrSlug: string): Company | undefined {
  const k = nameOrSlug.toLowerCase()
  return reg.companies.find((c) => c.slug === k || c.name.toLowerCase() === k)
}
