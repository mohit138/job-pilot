import { writeFileSync } from "fs"
import { mePath } from "../paths.ts"
import { loadStore, storePath, type StoredJob } from "../store.ts"
import { esc, jobLink } from "./cards.ts"

export interface ShortlistOpts {
  min: number
}

function row(j: StoredJob, n: number): string {
  return `<tr class="${j.status}">
  <td class="n">${n}</td>
  <td class="score">${j.score ?? "-"}</td>
  <td>${jobLink(j)}<div class="note">${esc(j.rankNote ?? "")}</div></td>
  <td>${esc(j.company)}</td>
  <td>${esc(j.location ?? "-")}</td>
  <td><span class="badge">${j.status}</span></td>
  <td class="id"><code>${esc(j.id)}</code></td>
</tr>`
}

/**
 * Write me/shortlist.html: ranked jobs at or above --min, best first, plus
 * everything already approved or in progress. Rows are numbered so the user
 * can say "approve 1 3 5".
 */
export function runShortlist(opts: ShortlistOpts): number {
  const store = loadStore(storePath())
  const all = Object.values(store.jobs)
  const jobs = all
    .filter((j) => (j.status === "ranked" && (j.score ?? 0) >= opts.min) || ["approved", "applying", "failed"].includes(j.status))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const applied = all.filter((j) => j.status === "applied").length
  const unranked = all.filter((j) => j.status === "new").length
  const generated = new Date().toISOString().slice(0, 16).replace("T", " ")

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Pilot shortlist</title>
<style>
:root { --bg:#fff; --fg:#1d1d1f; --muted:#6e6e73; --line:#e5e5ea; --accent:#0a66c2; --good:#1a7f37; --warn:#9a6700; }
@media (prefers-color-scheme: dark) { :root { --bg:#161618; --fg:#f2f2f7; --muted:#98989f; --line:#2c2c30; --accent:#4c9aff; --good:#3fb950; --warn:#d29922; } }
body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:14px/1.45 -apple-system, system-ui, sans-serif; }
main { max-width:1100px; margin:0 auto; }
h1 { font-size:20px; margin:0 0 4px; } p.meta { color:var(--muted); margin:0 0 20px; }
.wrap { overflow-x:auto; } table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:500; font-size:12px; text-transform:uppercase; letter-spacing:.03em; }
td.n, td.score { font-variant-numeric:tabular-nums; } td.score { font-weight:600; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
.note { color:var(--muted); font-size:12.5px; margin-top:2px; }
.badge { font-size:12px; padding:2px 8px; border-radius:10px; border:1px solid var(--line); }
tr.approved .badge { color:var(--good); border-color:var(--good); } tr.failed .badge { color:var(--warn); border-color:var(--warn); }
td.id code { font-size:11.5px; color:var(--muted); }
</style></head>
<body><main>
<h1>Shortlist</h1>
<p class="meta">${jobs.length} jobs scoring ${opts.min}+ or already approved · ${applied} applied · ${unranked} not ranked yet · ${generated} UTC<br>
To approve, tell Claude the row numbers, e.g. "approve 1 3 5".</p>
<div class="wrap"><table>
<thead><tr><th>#</th><th>Score</th><th>Role</th><th>Company</th><th>Location</th><th>Status</th><th>Id</th></tr></thead>
<tbody>
${jobs.map((j, i) => row(j, i + 1)).join("\n")}
</tbody></table></div>
</main></body></html>
`
  const out = mePath("shortlist.html")
  writeFileSync(out, html)
  process.stdout.write(
    JSON.stringify({ file: out, rows: jobs.map((j, i) => ({ n: i + 1, id: j.id, score: j.score ?? null, title: j.title, company: j.company, status: j.status })) }, null, 2) + "\n"
  )
  return 0
}
