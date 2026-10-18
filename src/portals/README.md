# Portal readers: endpoint reference

All endpoints are public and unauthenticated; they are what each ATS's own careers page calls.
Verified live 2026-10-18. When an adapter breaks, start here.

## Workday (`workday`)

Board: `host` (`adobe.wd5.myworkdayjobs.com`), `tenant` (`adobe`), `site` (`external_experienced`).
Careers fronts (Phenom etc.) usually link to `https://<host>/<site>/job/...` — detection reads those links.

- Search: `POST https://<host>/wday/cxs/<tenant>/<site>/jobs`
  body `{"appliedFacets":{},"limit":20,"offset":0,"searchText":"software"}` (limit max 20)
  → `{ total, jobPostings:[{title, externalPath, locationsText, postedOn:"Posted 30+ Days Ago", bulletFields}], facets:[...] }`
- Location: `facets[]` → `locationMainGroup` → sub-facets `locationCountry` / `locations`, each `values:[{descriptor:"Bangalore", id, count}]`.
  Pass `appliedFacets: {"locations": ["<id>"]}`.
- Detail: `GET https://<host>/wday/cxs/<tenant>/<site><externalPath>` → `jobPostingInfo {title, jobDescription(html), location, startDate, externalUrl}`
- Public job URL: `https://<host>/<site><externalPath>`
- robots.txt: allows `/<site>/`, disallows `/refreshFacet/`.

## Eightfold PCSX (`eightfold`)

Board: `host` (`apply.careers.microsoft.com`), `domain` (`microsoft.com`), optional `location` (the ATS's own string, `India, Karnataka, Bangalore`).

- Search: `GET https://<host>/api/pcsx/search?domain=<d>&query=<q>&location=<loc>&start=<n>&sort_by=timestamp` (10/page)
  → `{ data: { count, positions:[{id, name, locations[], postedTs(unix s), department, positionUrl}] } }`
  Location must match Eightfold's format; "Bangalore" alone works less reliably than the pinned string.
- Detail: `GET https://<host>/api/pcsx/position_details?position_id=<id>&domain=<d>&hl=en` → `data.jobDescription` (html)
- `/api/apply/v2/jobs` returns 403 "Not authorized for PCSX" — use `/api/pcsx/*` only.
- robots.txt: `Disallow: /` with `Allow: /api/pcsx` and `Allow: /careers`.

## Oracle HCM Candidate Experience (`oracle`)

Board: `host` (`jpmc.fa.oraclecloud.com`), `siteNumber` (`CX_1001`), optional `locationId` + `locationLabel` (copied from the careers URL).

- Search: `GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=<s>,limit=25,offset=0,sortBy=POSTING_DATES_DESC,keyword="<q>",locationId=<id>`
  → `items[0] { TotalJobsCount, requisitionList:[{Id, Title, PrimaryLocation, PostedDate, secondaryLocations[]}] }`
- Detail: `.../recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="<id>",siteNumber=<s>`
  → `items[0] {ExternalDescriptionStr, ExternalResponsibilitiesStr, ExternalQualificationsStr}` (html)
- Public job URL: `https://<host>/hcmUI/CandidateExperience/en/sites/<s>/job/<Id>`
- robots.txt on JPMC's host returns 403 (WAF) → "unavailable" → allowed under RFC 9309.

## Greenhouse (`greenhouse`)

- Search: `GET https://boards-api.greenhouse.io/v1/boards/<token>/jobs` → `{jobs:[{id,title,location{name},absolute_url,first_published,updated_at}]}` (all jobs, one call)
- Detail: `GET .../jobs/<id>` → `content` (entity-escaped html)

## Lever (`lever`)

- Search: `GET https://api.lever.co/v0/postings/<company>?mode=json` → `[{id,text,categories{location,allLocations,team},createdAt(ms),hostedUrl}]`
- Detail: `GET .../postings/<company>/<id>?mode=json` → `descriptionPlain`, `lists[]`, `additionalPlain`
- EU instance: `api.eu.lever.co` (not yet handled).

## Ashby (`ashby`)

- Search/detail: `GET https://api.ashbyhq.com/posting-api/job-board/<name>` → `{jobs:[{id,title,location,secondaryLocations[],publishedAt,jobUrl,descriptionPlain,isListed}]}`

## First-party JSON feed (`jsonfeed`)

For custom SPA careers sites. Find the feed in the site's JS bundle (`grep -o '/api/[^"]*' bundle.js`) or the browser network tab.
Board maps fields by dot path: `url`, `items`, `title`, `location`, `date`, `link`, optional `id`, `department`.

- Swiggy: `https://careers.swiggy.in/api/jobs.json` → `{generatedAt,total,jobs:[{t,c,l,b,e,d(ms),u}]}`; `u` links to `jobs.smartrecruiters.com/SWIGGY/<id>-<slug>`.
- Detail: fetches `link` and reads schema.org JSON-LD `JobPosting`, else microdata (`itemprop="description|responsibilities|qualifications"`), else page text.

## Job sitemap (`sitemap`)

For sites whose search page is robots-disallowed but whose sitemap is not (Radancy/TalentBrew, e.g. Intuit: `Disallow: /search-jobs/`).

- Board: `sitemap` URL, optional `jobPattern` regex with named groups `location`, `slug`, `id`.
  Default pattern: `/job/(?<location>[^/]+)/(?<slug>[^/]+)/\d+/(?<id>\d+)`.
- List has titles (from the slug) and city (from the path) but **no posting date**; `detail` reads the job page's JSON-LD `datePosted`.
- Sitemap indexes are followed one level (max 20 child sitemaps).

## Blocked / not used

- SmartRecruiters Posting API `api.smartrecruiters.com/v1/companies/<id>/postings` — robots.txt: `User-agent: * Disallow: /` (only LinkedInBot allowed).
- `jobs.intuit.com/search-jobs/*` — robots-disallowed; use the sitemap instead.
