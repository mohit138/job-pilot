# Job Pilot

Find jobs on the career sites of the companies **you** pick, rank them against your profile, and apply to the ones you approve, with Claude filling the forms in your own browser and you confirming every submit.

No job boards, no spam applications: just the companies you care about, and a jobs file that remembers everything you've seen and applied to.

> Status: early. Company search, ranking and the jobs file work. Browser apply is next.

## How it works

```
/add-company  →  /scrape  →  /rank  →  you approve  →  /apply (Claude fills, you confirm)  →  applied
                    ↑                                                                        │
                    └──────────────── me/jobs.json remembers every job ──────────────────────┘
```

- **/add-company** takes a company name and careers link, works out which hiring system it runs on (Greenhouse, Lever, Ashby, Workday, Eightfold, Oracle, JSON feeds or job sitemaps), checks the site's robots.txt allows it, and test-searches before saving.
- **/scrape** searches every company with your queries and city, and saves only jobs it has never seen.
- **/rank** scores new jobs 0-100 against your profile and writes a shortlist page; you approve by row number.
- **/jobs** lists jobs by status and lets you approve or skip them.

## Setup

You need [Claude Code](https://claude.com/claude-code) and [Bun](https://bun.sh).

```bash
git clone <this repo> job-pilot && cd job-pilot
bun install          # dev tools only; the CLI has no runtime dependencies
bun run jp init      # creates your private me/ folder and turns on the privacy hook
claude               # then type /setup and give it your resume
```

## Your data stays yours

Everything personal lives in `me/` (resume, answers, company list, jobs file), which git ignores. A pre-commit hook blocks commits containing files from `me/`, documents outside `example/`, your own details, or real-looking emails and phone numbers. `example/` holds a fake profile so you can try everything first.

## Ground rules

- Respects robots.txt: a site that says no is never added.
- Low request volume: one search per company per query.
- Claude never submits an application without your yes, never types your passwords, and never solves CAPTCHAs.

## Commands

| Command | What it does |
| --- | --- |
| `/setup` | Builds `me/` from your resume and a few questions |
| `/add-company` | Adds one or many companies (`Name - link` per line) |
| `/scrape` | Pulls new jobs from all your companies |
| `/rank` | Scores new jobs and writes `me/shortlist.html` |
| `/jobs` | Lists, approves or skips jobs |

The same things work without Claude: `bun run jp --help`.

## Development

```bash
bun test             # unit tests, no network
bun run typecheck
bun run check-private --all
```

## License

MIT
