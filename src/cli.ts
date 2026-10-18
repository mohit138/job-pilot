#!/usr/bin/env bun
// Job Pilot command line. Claude's slash commands call this; people can too.
// Portal reading (search, detail, add, list, ...) comes from src/portals;
// scrape, jobs and set work on the private jobs file in me/.

import { runSearch } from "./commands/search.ts"
import { runDetail } from "./commands/detail.ts"
import { runAdd, runList, runSetState } from "./commands/manage.ts"
import { runScrape } from "./commands/scrape.ts"
import { runJobs, runSet } from "./commands/jobs.ts"
import { runInit } from "./commands/init.ts"
import { runDescribe } from "./commands/describe.ts"
import { runShortlist } from "./commands/shortlist.ts"
import { checkRobots } from "./portals/robots.ts"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", c: "company", s: "status" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `job-pilot: find jobs on company career portals and track every application

USAGE  (bun run jp <command> ...)
  init                                   Create your private me/ folder from example/
  add --name "<Company>" --url "<link>"  Add a company (detects its job system, checks robots.txt, test-searches)
  list | remove | enable | disable <company>
  scrape [-c <companies>] [--format table|json]
                                         Search every company with me/search.json; save new jobs to me/jobs.json
  jobs [-s new,ranked] [-c <company>] [--sort score|date] [-n <limit>] [--format table|json]
                                         List jobs in the jobs file
  describe [<job-id>...] [-s new]        Fetch and keep full descriptions (default: all new jobs)
  shortlist [--min 60]                   Write me/shortlist.html: ranked jobs, best first, numbered
  set <job-id>... [-s <status>] [--score 0-100] [--note <text>] [--force]
                                         Update jobs (statuses: new ranked approved applying applied skipped failed closed)
  detail <job-id> [--format json|plain]  Fetch one job's full description from its portal
  search [-q <text>] [-l <city>] [...]   One-off portal search; nothing is saved
  robots <url>                           Check whether robots.txt allows reading a URL

ADD FLAGS
  -q / -l               Query and city for the live test search
  --ats <type> --board "k=v,..."   Skip detection: greenhouse(token) lever(company) ashby(name)
                        workday(host,tenant,site) eightfold(host,domain[,location])
                        oracle(host,siteNumber[,locationId]) sitemap(sitemap[,jobPattern])
                        jsonfeed(url,title,link[,items,location,date,id,department])
  --dry-run  --force  --notes <text>

SEARCH FLAGS
  -q <text>  -l <city>  --include-remote  -c <companies>  --jobage <days>
  --max-per-company <n>  -n <limit>  --format json|table|plain

Personal data lives in me/ (or $JOB_PILOT_HOME) and is never committed.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  init: new Set(["help", "h"]),
  search: new Set(["query", "location", "include-remote", "company", "jobage", "max-per-company", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
  add: new Set(["name", "url", "ats", "board", "query", "location", "dry-run", "force", "notes", "help", "h"]),
  list: new Set(["format", "help", "h"]),
  remove: new Set(["help", "h"]),
  enable: new Set(["help", "h"]),
  disable: new Set(["help", "h"]),
  scrape: new Set(["company", "format", "help", "h"]),
  jobs: new Set(["status", "company", "sort", "limit", "format", "help", "h"]),
  describe: new Set(["status", "help", "h"]),
  shortlist: new Set(["min", "help", "h"]),
  set: new Set(["status", "score", "note", "force", "help", "h"]),
  robots: new Set(["help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

function int(v: unknown, name: string): number | undefined | Error {
  if (v === undefined) return undefined
  const n = Number(v)
  if (typeof v !== "string" || !Number.isInteger(n) || n < 0) return new Error(`--${name} must be a non-negative integer`)
  return n
}

const list = (v: unknown): string[] | undefined => str(v)?.split(",").map((s) => s.trim()).filter(Boolean)

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const args = flags._ as string[]
  const cmd = args[0]
  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }
  const known = KNOWN_FLAGS[cmd]
  if (!known) return fail(`unknown command '${cmd}' - see --help`, "UNKNOWN_COMMAND")
  for (const key of Object.keys(flags)) {
    if (key !== "_" && !known.has(key)) {
      return fail(`unknown flag --${key} for '${cmd}' - flags are never silently ignored; see --help`, "UNKNOWN_FLAG")
    }
  }

  switch (cmd) {
    case "init":
      return runInit()

    case "search": {
      const format = (str(flags.format) ?? "json") as "json" | "table" | "plain"
      if (!["json", "table", "plain"].includes(format)) return fail("--format must be json, table or plain", "BAD_FORMAT")
      const jobage = int(flags.jobage, "jobage")
      const limit = int(flags.limit, "limit")
      const maxPer = int(flags["max-per-company"], "max-per-company")
      for (const v of [jobage, limit, maxPer]) if (v instanceof Error) return fail(v.message, "BAD_NUMBER")
      return runSearch({
        query: str(flags.query),
        location: str(flags.location),
        includeRemote: flags["include-remote"] === true,
        companies: list(flags.company),
        jobage: jobage as number | undefined,
        limit: limit as number | undefined,
        maxPerCompany: (maxPer as number | undefined) ?? 50,
        format,
      })
    }

    case "detail": {
      const id = args[1]
      if (!id) return fail("detail needs a job id like microsoft:1970393557037663", "NO_ID")
      const format = (str(flags.format) ?? "json") as "json" | "plain"
      if (!["json", "plain"].includes(format)) return fail("--format must be json or plain", "BAD_FORMAT")
      return runDetail({ id, format })
    }

    case "add": {
      const name = str(flags.name)
      const url = str(flags.url)
      if (!name || !url) return fail('add needs --name "<Company>" and --url "<careers link>"', "MISSING_ARGS")
      try {
        new URL(url)
      } catch {
        return fail(`--url is not a valid URL: ${url}`, "BAD_URL")
      }
      return runAdd({
        name,
        url,
        ats: str(flags.ats),
        board: str(flags.board),
        query: str(flags.query),
        location: str(flags.location),
        dryRun: flags["dry-run"] === true,
        force: flags.force === true,
        notes: str(flags.notes),
      })
    }

    case "list":
      return runList(undefined, (str(flags.format) ?? "table") as "json" | "table")

    case "scrape": {
      const format = (str(flags.format) ?? "table") as "json" | "table"
      if (!["json", "table"].includes(format)) return fail("--format must be json or table", "BAD_FORMAT")
      return runScrape({ companies: list(flags.company), format })
    }

    case "jobs": {
      const format = (str(flags.format) ?? "table") as "json" | "table"
      const sort = (str(flags.sort) ?? "score") as "score" | "date"
      if (!["json", "table"].includes(format)) return fail("--format must be json or table", "BAD_FORMAT")
      if (!["score", "date"].includes(sort)) return fail("--sort must be score or date", "BAD_SORT")
      const limit = int(flags.limit, "limit")
      if (limit instanceof Error) return fail(limit.message, "BAD_NUMBER")
      return runJobs({ statuses: list(flags.status), company: str(flags.company), sort, format, limit })
    }

    case "describe":
      return runDescribe({ ids: args.slice(1), statuses: list(flags.status) ?? ["new"] })

    case "shortlist": {
      const min = int(flags.min, "min")
      if (min instanceof Error) return fail(min.message, "BAD_NUMBER")
      return runShortlist({ min: min ?? 60 })
    }

    case "set": {
      const ids = args.slice(1)
      if (ids.length === 0) return fail("set needs one or more job ids", "NO_ID")
      const score = int(flags.score, "score")
      if (score instanceof Error || (typeof score === "number" && score > 100)) return fail("--score must be 0-100", "BAD_NUMBER")
      return runSet({ ids, status: str(flags.status), score, note: str(flags.note), force: flags.force === true })
    }

    case "robots": {
      const url = args[1]
      if (!url) return fail("robots needs a URL", "NO_URL")
      const verdict = await checkRobots(url)
      process.stdout.write(JSON.stringify(verdict, null, 2) + "\n")
      return verdict.allowed ? 0 : 1
    }
  }

  // remove | enable | disable
  const name = args[1]
  if (!name) return fail(`${cmd} needs a company name or slug`, "NO_COMPANY")
  return runSetState(name, cmd as "remove" | "enable" | "disable")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(JSON.stringify({ error: (e as Error).message, code: "UNEXPECTED" }) + "\n")
    process.exit(1)
  })
