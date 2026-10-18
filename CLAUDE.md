# Job Pilot

Finds jobs on the career portals of companies the user chose, ranks them, and applies to the ones they approve in their own browser, with the user confirming every submit.

## Layout
- `src/` - the `jp` command line (`bun run jp --help`). `src/portals/` reads 8 hiring systems (Greenhouse, Lever, Ashby, Workday, Eightfold, Oracle, JSON feeds, sitemaps); `src/portals/README.md` documents each endpoint.
- `.claude/commands/` - the slash commands: /setup, /add-company, /scrape, /rank, /jobs.
- `me/` - the user's private data: `resume.pdf`, `profile.md`, `answers.md`, `search.json`, `companies.json`, `jobs.json`. Git-ignored. Created by `bun run jp init` from `example/`.
- `example/` - fake versions of everything in `me/`. Keep them fake.

## Rules
- Personal data lives only in `me/`. Never copy it into code, docs, tests, commits or issues. The pre-commit hook (`scripts/check-private.ts`) blocks it; never bypass the hook.
- `me/jobs.json` is the memory of what was seen and applied to. Change it only through `bun run jp set`, never by hand.
- Respect robots.txt: a company whose feed is disallowed is not added, whatever the user says. Keep request volume low.
- Never invent facts about the user. Anything not in `me/` gets asked.
- Applying (coming in a later milestone): fill forms in the user's own Chrome, stop on the final review page, and submit only after the user says so for that job. Never solve or bypass a CAPTCHA, never type a password; hand those to the user.

## Tests
`bun test` (unit tests; no network). `bun run typecheck`. Live portal checks: `bun run jp add ... --dry-run`.
