# /scrape - Pull new jobs from your companies

1. Run `bun run jp scrape` (add `-c <name,name>` if the user named specific companies).
2. It searches every enabled company in `me/companies.json` with each query in `me/search.json`, then saves only jobs it has never seen to `me/jobs.json` as `new`. Jobs already applied to or skipped are never shown again.
3. Report in a few lines: how many new jobs, per-company counts, and any company that errored (with the one-line reason). List the new jobs as a short table: company, title, location, id.
4. If a company errors repeatedly, suggest `bun run jp disable <company>` or re-adding it with `/add-company`.
5. Next step: "Run `/rank` to score them", or `/jobs` to see everything.

Never edit `me/jobs.json` by hand; use `bun run jp set`.
