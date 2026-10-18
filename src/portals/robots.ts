// robots.txt gate, run when a company is added. A source whose robots.txt
// disallows the feed URL for "*" or for this tool is refused outright.
// Semantics follow RFC 9309:
//   * 200 + robots rules      -> longest match wins; a tie goes to Disallow
//   * 200 but not robots text -> the site publishes no policy (SPA fallback page): allowed
//   * 4xx (incl. 401/403/404) -> "unavailable": allowed (RFC 9309 §2.3.1.3)
//   * 5xx / network failure   -> "unreachable": treated as fully disallowed (§2.3.1.4)

import { UA } from "./helpers.ts"

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
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)))
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

export async function checkRobots(url: string): Promise<RobotsVerdict> {
  const u = new URL(url)
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`
  let res: Response
  try {
    res = await fetch(robotsUrl, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) })
  } catch (e) {
    return { allowed: false, reason: `robots.txt unreachable (${(e as Error).message}) — treated as disallow`, robotsUrl }
  }
  if (res.status >= 500) return { allowed: false, reason: `robots.txt returned ${res.status} — treated as disallow`, robotsUrl }
  if (res.status >= 400) return { allowed: true, reason: `robots.txt unavailable (HTTP ${res.status}) — no restrictions apply (RFC 9309)`, robotsUrl }
  const body = await res.text()
  if (!/^\s*user-agent\s*:/im.test(body)) {
    return { allowed: true, reason: "site publishes no robots.txt rules", robotsUrl }
  }
  const path = u.pathname + u.search
  const allowed = isAllowed(rulesFor(body), path)
  return {
    allowed,
    reason: allowed ? `robots.txt allows ${u.pathname}` : `robots.txt disallows ${u.pathname} for "*"/${AGENT_TOKEN}`,
    robotsUrl,
  }
}
