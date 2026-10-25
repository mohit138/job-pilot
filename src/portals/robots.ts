// robots.txt gate. Run when a company is added (a source whose robots.txt
// disallows the feed URL for "*" or for this tool is refused outright), and
// again for every request through helpers.rawFetch, with one robots.txt read
// per host per process.
// Semantics follow RFC 9309:
//   * 200 + robots rules      -> longest match wins; a tie goes to Disallow
//   * 200 but not robots text -> the site publishes no policy (SPA fallback page): allowed
//   * 4xx (incl. 401/403/404) -> "unavailable": allowed (RFC 9309 §2.3.1.3)
//   * 5xx / network failure   -> "unreachable": treated as fully disallowed (§2.3.1.4)

// Lives here rather than in helpers.ts so helpers can import this file without a cycle.
export const UA = "Mozilla/5.0 (compatible; job-pilot/0.1)"

const AGENT_TOKEN = "job-pilot"

export interface RobotsVerdict {
  allowed: boolean
  reason: string
  robotsUrl: string
}

interface Rule {
  allow: boolean
  path: string
}

/** Parse the rule groups that apply to this tool: its own group if present, else "*". */
export function rulesFor(body: string, agent = AGENT_TOKEN): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let current: { agents: string[]; rules: Rule[] } | null = null
  let lastWasAgent = false
  for (const rawLine of body.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim()
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === "user-agent") {
      if (!value) continue
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value !== "" || key === "allow") current.rules.push({ allow: key === "allow", path: value })
      lastWasAgent = false
    } else {
      lastWasAgent = false
    }
  }
  // Exact product-token match, case-insensitive: "pilot" or "job" must not count as us.
  const own = groups.filter((g) => g.agents.includes(agent.toLowerCase()))
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"))
  return chosen.flatMap((g) => g.rules)
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$")
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp("^" + body + (anchored ? "$" : "")).test(path)
}

/** Decide one path against parsed rules. */
export function isAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null
  for (const r of rules) {
    if (r.path === "" || !patternMatches(r.path, path)) continue
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && !r.allow)) best = r
  }
  return best ? best.allow : true
}

type Policy = { rules: Rule[] } | { all: boolean; reason: string }

async function fetchPolicy(robotsUrl: string): Promise<Policy> {
  let res: Response
  try {
    res = await fetch(robotsUrl, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) })
  } catch (e) {
    return { all: false, reason: `robots.txt unreachable (${(e as Error).message}) — treated as disallow` }
  }
  if (res.status >= 500) return { all: false, reason: `robots.txt returned ${res.status} — treated as disallow` }
  if (res.status >= 400) return { all: true, reason: `robots.txt unavailable (HTTP ${res.status}) — no restrictions apply (RFC 9309)` }
  const body = await res.text()
  if (!/^\s*user-agent\s*:/im.test(body)) return { all: true, reason: "site publishes no robots.txt rules" }
  return { rules: rulesFor(body) }
}

// One robots.txt read per host for the life of the process.
const policies = new Map<string, Promise<Policy>>()

function policyFor(u: URL): Promise<Policy> {
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`
  let p = policies.get(robotsUrl)
  if (!p) policies.set(robotsUrl, (p = fetchPolicy(robotsUrl)))
  return p
}

/** For tests. */
export function clearRobotsCache(): void {
  policies.clear()
}

/** Per-request check used by the shared fetch path. */
export async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url)
  const policy = await policyFor(u)
  return "rules" in policy ? isAllowed(policy.rules, u.pathname + u.search) : policy.all
}

export async function checkRobots(url: string): Promise<RobotsVerdict> {
  const u = new URL(url)
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`
  const policy = await policyFor(u)
  if (!("rules" in policy)) return { allowed: policy.all, reason: policy.reason, robotsUrl }
  const allowed = isAllowed(policy.rules, u.pathname + u.search)
  return {
    allowed,
    reason: allowed ? `robots.txt allows ${u.pathname}` : `robots.txt disallows ${u.pathname} for "*"/${AGENT_TOKEN}`,
    robotsUrl,
  }
}
