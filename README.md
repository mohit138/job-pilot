# Job Pilot

Find jobs on the career sites of the companies **you** pick, rank them against your profile, and apply to the ones you approve: Claude fills what it knows in your own Chrome, and you review, fill the rest and press submit.

No job boards, no spam applications: just the companies you care about, and a jobs file that remembers everything you've seen and applied to.

> Status: early. Company search, ranking, the jobs file and browser apply work.

## How it works

```
/add-company → "find me jobs" (/scrape + /rank) → approve on /board → /apply (Claude fills, you submit) → applied
                        ↑                                                                               │
                        └──────────────────── me/jobs.json remembers every job ─────────────────────────┘
```

Job Pilot has five parts:

1. **Company portals.** Most companies post jobs through a hiring system (Greenhouse, Lever, Ashby, Workday, Eightfold, Oracle, or their own job feed or sitemap). `/add-company` works out which one a company uses, checks its robots.txt allows reading it, and test-searches before saving it to your list.
2. **The jobs file.** `/scrape` searches every company on your list with your search words and city, and saves only jobs it hasn't seen before to `me/jobs.json`. That file is the memory: a job you skipped or applied to is never shown again.
3. **Ranking.** `/rank` has Claude read each new job and score it 0-100 against `me/profile.md`, with a one-line reason, so the best ones float up.
4. **The board.** `/board` opens a page that runs only on your computer (http://127.0.0.1:4317). Approve or skip shortlisted jobs there, and watch applications as they happen.
5. **Apply hand-off.** `/apply` opens each approved job in your Chrome through the Claude in Chrome extension and fills every field that `me/answers.md`, `me/profile.md` or your resume answers. Then it hands the tab back with a checklist of what's left. You fill those, check everything and press submit; Claude never does. Sign-ins, email codes, terms and CAPTCHAs are always yours.

**Where your data lives.** Everything about you (resume, profile, answers, company list, jobs file) lives in the `me/` folder on your computer. Git ignores `me/`, and a pre-commit hook refuses any commit that contains files from it, documents outside `example/`, or your name, email or phone, so your details never reach git even by accident. `example/` holds a made-up person (Alex Sample) so the repo works out of the box without anyone's real data.

## Setup

You need:
- [Claude Code](https://claude.com/claude-code)
- [Bun](https://bun.sh)
- For `/apply`: Google Chrome with the [Claude in Chrome](https://claude.ai/chrome) extension, signed in and connected to Claude Code

```bash
git clone <this repo> job-pilot && cd job-pilot
bun install          # dev tools only; the CLI has no runtime dependencies
claude               # then type /setup and give it your resume
```

## Your first run

1. **Set up.** `/setup` with your resume. It creates `me/` (and turns on the privacy hook), writes `me/profile.md` and `me/answers.md`, and asks what the resume can't tell it. Check both files.
2. **Add companies.** `me/` starts with no companies: add the ones you want, e.g. `/add-company Stripe - https://stripe.com/jobs` (one per line for several). Each is checked against robots.txt first. `example/companies.sample.json` shows what saved entries look like.
3. **Find jobs.** Say "find me jobs". Claude runs `/scrape` to pull new postings, then `/rank` to score them, and shows the shortlist.
4. **Approve.** `/board` opens http://127.0.0.1:4317. Approve or skip from the shortlist (or tell Claude "approve 1 3 5").
5. **Apply.** `/apply`. Claude opens each approved job in your Chrome and fills what `me/` answers. If a site wants a sign-in or email code, it waits for you.
6. **You submit.** Claude gives you a checklist of the fields left, and the board shows "Ready for you". Fill them, review, press submit on the site, then press "I submitted" on the board (or tell Claude). The job is recorded as applied for good, so you're never asked about it again. "Later" puts it back in the queue.

Want to try step 5 first? `/apply demo` fills a practice form at http://127.0.0.1:4317/demo that sends nothing.

Anything a form asks that `me/answers.md` doesn't cover is left for you, never guessed. Add the answer to `me/answers.md` and it's filled next time.

## Commands

| Command | What it does |
| --- | --- |
| `/setup` | Builds `me/` from your resume and a few questions |
| `/add-company` | Adds one or many companies (`Name - link` per line) |
| `/scrape` | Pulls new jobs from all your companies |
| `/rank` | Scores new jobs and writes `me/shortlist.html` |
| `/board` | Opens the live page: approve, skip, and follow applications |
| `/jobs` | Lists, approves or skips jobs in chat |
| `/apply` | Fills approved applications in your Chrome; you review and submit each (`/apply demo` to practise) |

"find me jobs" is `/scrape` then `/rank`.

The same things work without Claude: `bun run jp --help`. To run the board yourself, use `bun run jp board` in a second terminal (it keeps running until you stop it).

## Ground rules

- Respects robots.txt: a site that says no is never added.
- Low request volume: one search per company per query.
- Claude never submits an application (you press submit), never types your passwords or codes, never accepts terms, and never solves CAPTCHAs.
- Claude never guesses an answer: if it isn't in `me/`, it's left for you.

## Development

```bash
bun test             # unit tests, no network
bun run typecheck
bun run check-private --all
```

## License

MIT
