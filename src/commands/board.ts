// `jp board`: a live page on this machine (http://127.0.0.1:4317) showing the
// shortlist, the approved queue and each application's progress. It re-reads
// the jobs file every couple of seconds, so it follows along while Claude
// applies. Its buttons approve, skip or un-approve, and for a job being applied
// to, "I submitted" (once you've pressed submit on the portal) or "Later".
// It also serves the practice form at /demo.

import { mkdirSync, writeFileSync } from "fs"
import { dirname } from "path"
import { jobCard, type CardAction } from "./cards.ts"
import { boardPortFile, DEMO_FORM, isDemo } from "./demo.ts"
import { loadStore, setStatus, STATUSES, storePath, updateStore, type Status, type StoredJob } from "../store.ts"

export interface BoardOpts {
  port: number
  min: number
}

/** Moves the page may make. Everything else (applying, failed) belongs to /apply. */
const PAGE_MOVES = new Map<Status, Status[]>([
  // "I submitted": only for the job being applied to, never to undo or skip ahead.
  ["applied", ["applying"]],
  ["approved", ["ranked", "skipped", "failed", "applying"]],
  ["skipped", ["ranked", "approved"]],
  ["ranked", ["approved", "skipped"]],
])

export function pageMoveAllowed(from: Status, to: Status): boolean {
  return PAGE_MOVES.get(to)?.includes(from) ?? false
}

/** The buttons each section's cards carry. */
const ACTIONS: Record<string, CardAction[]> = {
  inProgress: [["applied", "I submitted", "go"], ["approved", "Later", ""]],
  shortlist: [["approved", "Approve", "go"], ["skipped", "Skip", ""]],
  approved: [["ranked", "Un-approve", ""]],
  failed: [["approved", "Retry", "go"], ["skipped", "Skip", ""]],
  skipped: [["ranked", "Back to shortlist", ""]],
}
const SHOWS_LAST = new Set(["inProgress", "failed", "applied"])

function view(min: number) {
  const jobs = Object.values(loadStore(storePath()).jobs)
  const byScore = (a: StoredJob, b: StoredJob) => (b.score ?? -1) - (a.score ?? -1)
  const recent = (a: StoredJob, b: StoredJob) => (b.history.at(-1)?.at ?? "").localeCompare(a.history.at(-1)?.at ?? "")
  // Cards are rendered here, with the same markup code as the shortlist page.
  const pick = (key: string, f: (j: StoredJob) => boolean, sort = byScore) =>
    jobs.filter(f).sort(sort).map((j) => ({ id: j.id, html: jobCard(j, ACTIONS[key], SHOWS_LAST.has(key)) }))
  return {
    inProgress: pick("inProgress", (j) => j.status === "applying", recent),
    approved: pick("approved", (j) => j.status === "approved"),
    shortlist: pick("shortlist", (j) => j.status === "ranked" && (j.score ?? 0) >= min),
    applied: pick("applied", (j) => j.status === "applied", recent),
    failed: pick("failed", (j) => j.status === "failed", recent),
    skipped: pick("skipped", (j) => j.status === "skipped", recent),
    counts: {
      unranked: jobs.filter((j) => j.status === "new").length,
      belowMin: jobs.filter((j) => j.status === "ranked" && (j.score ?? 0) < min).length,
      skipped: jobs.filter((j) => j.status === "skipped").length,
    },
    min,
  }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })

/** The board's request handler, for a server listening on 127.0.0.1:<port>. */
export function boardHandler(opts: { port: number; min: number }): (req: Request) => Promise<Response> {
  // Only these names: another name pointing at 127.0.0.1 (DNS rebinding) gets nothing.
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`])
  const origins = new Set([...hosts].map((h) => `http://${h}`))
  return async (req) => {
    if (!hosts.has((req.headers.get("host") ?? "").toLowerCase())) return new Response("forbidden host", { status: 403 })
    const url = new URL(req.url)
    if (req.method === "GET" && url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } })
    if (req.method === "GET" && url.pathname === "/demo") return new Response(DEMO_FORM, { headers: { "content-type": "text/html; charset=utf-8" } })
    if (req.method === "GET" && url.pathname === "/api/board") return json(view(opts.min))
    if (req.method === "POST" && url.pathname === "/api/set") {
      // Only this page may change jobs: other sites open in the browser can't post here.
      if (!origins.has(req.headers.get("origin") ?? "")) return json({ error: "wrong origin" }, 403)
      const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown } | null
      if (typeof body?.id !== "string" || typeof body.status !== "string") return json({ error: "needs id and status" }, 400)
      const { id, status } = body
      if (!STATUSES.includes(status as Status)) return json({ error: `unknown status ${status}` }, 400)
      return updateStore(storePath(), (store) => {
        const job = Object.hasOwn(store.jobs, id) ? store.jobs[id] : undefined
        if (!job) return json({ error: "unknown job" }, 404)
        const to = status as Status
        if (!pageMoveAllowed(job.status, to)) return json({ error: `can't move ${job.status} to ${to} from the page` }, 409)
        if (isDemo(job.id)) delete store.jobs[job.id] // practice over, nothing to keep
        else setStatus(job, to, to === "applied" ? "You submitted it (from the board)" : "from the board")
        return json({ id: job.id, status: job.status })
      })
    }
    return new Response("not found", { status: 404 })
  }
}

/** Serves until Ctrl+C, so the returned promise never settles on its own. */
export function runBoard(opts: BoardOpts): Promise<number> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: opts.port, fetch: (req) => handler(req) })
  const handler = boardHandler({ port: server.port!, min: opts.min })
  // So `jp apply demo` points the practice job at this port.
  mkdirSync(dirname(boardPortFile()), { recursive: true })
  writeFileSync(boardPortFile(), `${server.port}\n`)
  process.stdout.write(`Job Pilot board: http://127.0.0.1:${server.port}  (Ctrl+C to stop)\n`)
  return new Promise(() => void server)
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Pilot board</title>
<style>
:root { --bg:#fff; --fg:#1d1d1f; --muted:#6e6e73; --line:#e5e5ea; --card:#f7f7f9; --accent:#0a66c2; --good:#1a7f37; --warn:#9a6700; --bad:#cf222e; }
@media (prefers-color-scheme: dark) { :root { --bg:#161618; --fg:#f2f2f7; --muted:#98989f; --line:#2c2c30; --card:#1f1f22; --accent:#4c9aff; --good:#3fb950; --warn:#d29922; --bad:#f85149; } }
* { box-sizing:border-box; }
body { margin:0; padding:20px 16px; background:var(--bg); color:var(--fg); font:14px/1.45 -apple-system, system-ui, sans-serif; }
main { max-width:960px; margin:0 auto; }
h1 { font-size:20px; margin:0; } .meta { color:var(--muted); margin:2px 0 18px; font-size:13px; }
h2 { font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:22px 0 8px; font-weight:600; }
h2 .c { font-weight:400; }
.job { display:grid; grid-template-columns:44px 1fr auto; gap:10px; align-items:start; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--card); margin-bottom:8px; }
.score { font-weight:700; font-size:16px; font-variant-numeric:tabular-nums; text-align:center; padding-top:1px; }
.t a { color:var(--fg); font-weight:600; text-decoration:none; } .t a:hover { color:var(--accent); }
.sub { color:var(--muted); font-size:12.5px; } .note { font-size:12.5px; margin-top:3px; }
.live { color:var(--warn); font-size:12.5px; margin-top:3px; font-weight:600; }
.acts { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
button { font:inherit; font-size:12.5px; padding:4px 10px; border-radius:7px; border:1px solid var(--line); background:var(--bg); color:var(--fg); cursor:pointer; }
button.go { border-color:var(--good); color:var(--good); } button:hover { filter:brightness(.95); }
.inprog .job { border-color:var(--warn); } .applied .job { opacity:.75; } .failed .job { border-color:var(--bad); }
.live.you { color:var(--accent); font-size:13.5px; }
.inprog .job:has(.you) { border-color:var(--accent); border-width:2px; }
.when { color:var(--muted); font-size:12px; font-weight:400; }
details > summary { cursor:pointer; list-style:none; } details > summary::-webkit-details-marker { display:none; }
details > summary h2::before { content:"▸ "; } details[open] > summary h2::before { content:"▾ "; }
.empty { color:var(--muted); font-size:13px; padding:4px 0 8px; }
.err { color:var(--bad); font-weight:600; margin:0 0 10px; } .err:empty { display:none; }
.hint { border:1px dashed var(--line); border-radius:10px; padding:10px 12px; color:var(--muted); font-size:13px; }
@media (max-width:560px) { .job { grid-template-columns:36px 1fr; } .acts { grid-column:1 / -1; justify-content:flex-start; } }
</style></head>
<body><main>
<h1>Job Pilot</h1>
<div class="meta" id="meta">Loading…</div>
<div class="err" id="err" role="alert"></div>
<div id="root"></div>
</main>
<script>
function section(key, title, jobs, empty, collapsed) {
  if (!jobs.length && !empty) return "";
  const head = '<h2>'+title+' <span class="c">'+jobs.length+'</span></h2>';
  const body = jobs.length ? jobs.map((j) => j.html).join("") : '<div class="empty">'+empty+'</div>';
  const cls = key === "inProgress" ? "inprog" : key;
  if (collapsed) return '<section class="'+cls+'"><details'+(openSections.has(key) ? " open" : "")+' data-key="'+key+'"><summary>'+head+'</summary>'+body+'</details></section>';
  return '<section class="'+cls+'">'+head+body+'</section>';
}
// Remember which collapsed lists are open across the 2-second refresh.
const openSections = new Set();
document.addEventListener("toggle", (e) => { const k = e.target.dataset?.key; if (k) e.target.open ? openSections.add(k) : openSections.delete(k); }, true);
let last = "";
async function load() {
  try {
    const b = await (await fetch("/api/board")).json();
    const sig = JSON.stringify(b); if (sig === last) return; last = sig;
    document.getElementById("meta").textContent = b.counts.unranked + " not ranked yet · " + b.counts.belowMin + " scored under " + b.min + " · " + b.counts.skipped + " skipped";
    document.getElementById("root").innerHTML =
      section("inProgress", "Applying now", b.inProgress, "")
      + section("failed", "Needs a look", b.failed, "")
      + section("approved", "Approved, waiting to apply", b.approved, "Approve jobs below, then tell Claude \\"apply to my approved jobs\\".")
      + section("shortlist", "Shortlist", b.shortlist, "Nothing ranked yet. Ask Claude to find and rank jobs.")
      + section("applied", "Applied", b.applied, "")
      + section("skipped", "Skipped", b.skipped, "", true);
  } catch { document.getElementById("meta").textContent = "Can't reach the board. Is jp board still running?"; }
}
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]"); if (!btn) return;
  if (btn.dataset.s === "applied" && !confirm("Mark this as applied? Only do this once you've pressed submit on the portal.")) return;
  btn.disabled = true;
  const err = document.getElementById("err");
  err.textContent = "";
  try {
    const r = await fetch("/api/set", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ id: btn.dataset.id, status: btn.dataset.s }) });
    if (!r.ok) err.textContent = "Not saved: " + ((await r.json().catch(() => null))?.error || "HTTP " + r.status);
  } catch { err.textContent = "Not saved: can't reach the board. Is jp board still running?"; }
  last = ""; load();
});
load(); setInterval(load, 2000);
</script>
</body></html>
`
