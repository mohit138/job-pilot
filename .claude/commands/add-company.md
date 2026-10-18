# /add-company - Add Company Career Portals as Job Sources

You are adding one or more companies' own career portals to the user's job sources. Each company lands in the user's private company list (`me/companies.json`), which `/scrape` searches.

The CLI does the mechanical work (detect the job system, check robots.txt, test-run a live search, save). Your job is the part it can't do: parse what the user gave you, investigate custom careers sites the CLI can't recognise, and report results clearly.

`$ARGUMENTS` holds the input. Accepted shapes, possibly mixed:
- `Microsoft https://apply.careers.microsoft.com/careers?...` (one company)
- several lines of `name - link`, `name, link`, or `name link`
- a path to a CSV/text file with one company per line
- `list`, `remove <company>`, `disable <company>`, `enable <company>`: pass straight to the CLI and show the result
- nothing: ask for company names and careers links, then stop

The CLI is `bun run jp`. Below it is written as `CLI`.

Follow these steps **in order**.

---

## Step 1: Parse the input

Build a list of `(name, url)` pairs. Use the company's common short name (`JPMC`, not `JPMorgan Chase & Co. careers`). If a line has a name but no link, find the official careers page with WebSearch. Use only the employer's own domain or a known ATS host, never a third-party job board. Confirm the link with the user only if it is ambiguous.

Pick the **test location** from `me/search.json` (`location`, e.g. `Bengaluru`). Pick a broad **test query** such as `engineer` or `software`, drawn from its `queries`.

## Step 2: Add each company

Run each company (in parallel for batches of up to ~10, then the next batch):

```bash
CLI add --name "<name>" --url "<url>" -q "<test query>" -l "<test city>"
```

Read the JSON on stdout and the error on stderr:

| Outcome | Meaning | What to do |
|---|---|---|
| `status: added` / `updated` | Detected, allowed by robots.txt, returned jobs | Record it for the summary |
| `code: UNSUPPORTED` | Not a recognised job system | **Step 3** |
| `code: ROBOTS_DISALLOWED` | The site's robots.txt forbids that feed | Do **not** work around it. Report it, and try Step 3 only if another first-party feed exists that robots.txt allows |
| `code: TEST_FAILED` with 0 jobs | Detected, but no open jobs right now (or the board coordinates are wrong) | Check the careers page by hand. If it really has no openings, offer `--force`; if the board looks wrong, go to Step 3 |
| other errors | Network / unexpected | Retry once, then report |

A `matching: 0` with `jobsFetched > 0` is fine: the company is added and simply has no matching openings in that city today.

## Step 3: Investigate an unrecognised careers site

Find the system **behind** the page. Spend at most a few requests per company:

1. **Apply links:** WebFetch the careers page or one job page and look at where the "Apply" button points. Hosts like `*.myworkdayjobs.com`, `boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com` or `*.oraclecloud.com/hcmUI` mean you can re-run `add` with that link as `--url`.
2. **Single-page apps** (the HTML is an empty shell plus a script bundle): fetch the bundle (`<script src="/assets/index-*.js">`) and grep it for API paths, e.g. `grep -o '/api/[^"]*' bundle.js`. A first-party JSON list of jobs can be added as `--ats jsonfeed`. Map the fields from one sample item:
   ```bash
   CLI add --name "Swiggy" --url "<careers link>" --ats jsonfeed \
     --board "url=https://careers.swiggy.in/api/jobs.json,items=jobs,title=t,location=l,date=d,link=u,department=b" -q software -l Bengaluru
   ```
3. **Search page disallowed but sitemap allowed:** if `https://<host>/sitemap.xml` lists job URLs, use `--ats sitemap --board "sitemap=<url>"`, adding a `jobPattern` regex with `(?<location>)`, `(?<slug>)` and `(?<id>)` groups if the URLs differ from `/job/<city>/<title>/<n>/<id>`.
4. **Eightfold** (`/careers?pid=...`, `apply.careers.<company>.com`): `--ats eightfold --board "host=<host>,domain=<company domain>,location=<the site's own location string>"`.

Rules while investigating:
- Check `CLI robots '<feed url>'` before relying on any endpoint you found yourself. The CLI re-checks robots.txt on `add`, but don't spend effort on a feed the site has disallowed.
- Never use login-only or authenticated APIs, never send browser-impersonating headers from the CLI, and never scrape a path robots.txt disallows.
- Write a short `--notes "..."` saying how the source was found, so the next person can repair it.
- If nothing usable exists (e.g. the jobs live only on a robots-disallowed third-party ATS), say so plainly. The user can still check that careers page by hand.

## Step 4: Summary

Show one table:

```
| Company | Job system | Found via | Jobs fetched (test) | Matching <query> in <city> | Status |
```

Then:
- A few sample titles from the best sources, so the user can see the results are real
- Companies that failed or were refused, with the reason in one line each
- The registry path and total company count (`CLI list`)
- Next step: "Run `/scrape` to pull their jobs."

## Rules

- Never hand-edit `me/companies.json` when the CLI can do it; `add` runs the robots.txt and live-test gates.
- Never add a company whose robots.txt disallows the feed, even if the user insists. Explain the WebSearch fallback instead.
- Keep request volume low: one `add` per company, a handful of fetches for investigation, no crawling.
- The registry is per user. Don't add companies the user didn't ask for.
