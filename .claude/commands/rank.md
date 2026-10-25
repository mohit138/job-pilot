# /rank - Score new jobs against your profile

Score every `new` job in the jobs file from 0 to 100 for how well it fits the user, so the best ones float up for approval.

## Steps

1. Read `me/profile.md` once. It holds target roles, skills, experience, location and deal-breakers.
2. Run `bun run jp describe` to fetch full descriptions for all new jobs (it skips ones already fetched and marks vanished postings `closed`).
3. Work in batches of 10: `bun run jp jobs -s new -n 10 --format json`. For each job, read the title, location and description, then score it with the rubric below. Save each one right away:
   ```bash
   bun run jp set <id> -s ranked --score <0-100> --note "<one line: strongest reason, biggest gap>"
   ```
   Repeat until `jobs -s new` is empty. Saving per job means an interrupted run loses nothing.
4. Run `bun run jp shortlist` (add `--min <n>` if the user asked for a different cut-off; default 60). It writes `me/shortlist.html` and prints the numbered rows.
5. Reply with: how many were ranked, the top 10 as a table (# · score · company · title · note), and the path to `me/shortlist.html` (on a Mac: `open me/shortlist.html`). End with: "Say which to approve, e.g. approve 1 3 5, or use the board (`/board`, http://127.0.0.1:4317)."

When the user then says "approve 1 3 5" (or titles), map the numbers to ids from the shortlist you showed, run `bun run jp set <ids> -s approved`, and confirm the list back. Approving only queues the job for /apply, where Claude fills the form and the user reviews and submits it.

## Rubric

Start from these weights and add up:

| Part | Points | What earns them |
| --- | --- | --- |
| Role fit | 30 | The title and day-to-day work match a target role and the seniority the profile asks for |
| Skills | 30 | Required skills the profile lists as strong; partial credit for "working knowledge" |
| Experience | 15 | Years and level asked for are within reach (one level above is fine) |
| Domain and company | 15 | Domains and company type the profile says it wants |
| Location | 10 | In the user's city, or remote in their country |

Then apply the deal-breakers: if a job hits one, cap its score at 20 and name the deal-breaker in the note.

## Rules

- Score only from what the posting and `me/profile.md` say. If the description is missing, score on the title and say so in the note.
- Be honest and spread the scores: a vague match is 40-60, not 75. Reserve 85+ for jobs where role, skills and level all line up.
- Notes are one short line the user can scan, e.g. "Java/Spring backend in payments; asks 6+ yrs (you have 4)".
- Never edit `me/jobs.json` by hand.
