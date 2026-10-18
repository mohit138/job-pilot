// Search settings (me/search.json): what /scrape looks for on every portal.
// Plain JSON so both people and Claude can edit it.

import { existsSync, readFileSync } from "fs"
import { mePath } from "./paths.ts"

export interface SearchSettings {
  /** City, e.g. "Bengaluru". Aliases like Bangalore match. */
  location: string
  /** Also keep remote roles that mention India. */
  includeRemote: boolean
  /** One portal search per query; results are merged and de-duplicated. */
  queries: string[]
  /** Only jobs posted within N days (undated jobs are kept). */
  jobage: number
  maxPerCompany: number
  /** Drop jobs whose title contains any of these words (case-insensitive). */
  excludeTitleWords: string[]
}

export const DEFAULT_SETTINGS: SearchSettings = {
  location: "Bengaluru",
  includeRemote: true,
  queries: ["software engineer"],
  jobage: 30,
  maxPerCompany: 50,
  excludeTitleWords: ["intern"],
}

export function settingsPath(): string {
  return mePath("search.json")
}

export function loadSettings(path = settingsPath()): SearchSettings {
  if (!existsSync(path)) return DEFAULT_SETTINGS
  const data = JSON.parse(readFileSync(path, "utf8"))
  const s = { ...DEFAULT_SETTINGS, ...data }
  if (!Array.isArray(s.queries) || s.queries.length === 0) throw new Error(`${path}: "queries" must be a non-empty list`)
  return s
}

export function excludedByTitle(title: string, words: string[]): boolean {
  const t = title.toLowerCase()
  return words.some((w) => w && new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t))
}
