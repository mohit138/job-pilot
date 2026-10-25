// A practice application form, served by `jp board` at /demo. It looks like a
// Greenhouse form and asks a few things answers.md can't answer, so /apply can
// show the hand-off (Claude fills what it knows, you fill the rest and submit)
// without touching a real company. Its submit button sends nothing anywhere.

import { readFileSync } from "fs"
import { mePath } from "../paths.ts"
import type { StoredJob } from "../store.ts"

export const DEFAULT_BOARD_PORT = 4317
/** `jp board` writes the port it is serving on here, so /apply demo points at the right one. */
export const boardPortFile = () => mePath(".board-port")

/** Where `jp board` serves the practice form: the port it last started on, else the default. */
export function boardOrigin(): string {
  let port = DEFAULT_BOARD_PORT
  try {
    const n = Number(readFileSync(boardPortFile(), "utf8").trim())
    if (Number.isInteger(n) && n > 0 && n < 65536) port = n
  } catch {
    /* no board started yet */
  }
  return `http://127.0.0.1:${port}`
}

export const DEMO_ID = "demo:practice"
export const isDemo = (id: string) => id.startsWith("demo:")

export function demoJob(origin: string): StoredJob {
  const t = new Date().toISOString()
  return {
    id: DEMO_ID,
    title: "Software Engineer (practice form)",
    company: "Demo Co",
    location: "Anywhere",
    date: t.slice(0, 10),
    url: `${origin}/demo`,
    department: null,
    status: "applying",
    firstSeen: t,
    lastSeen: t,
    history: [{ at: t, status: "applying", note: "Practice: opening the demo form" }],
  }
}

const yesNo = '<option value="">Select...</option><option>Yes</option><option>No</option>'
const countries = ["Australia", "Canada", "Germany", "India", "Singapore", "United Kingdom", "United States"]
  .map((c) => `<option>${c}</option>`)
  .join("")

export const DEMO_FORM = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo Co - Apply</title>
<style>
:root { --bg:#fff; --fg:#1d1d1f; --muted:#6e6e73; --line:#d2d2d7; --accent:#3a6f43; --warnbg:#fff8e1; --warnline:#e6c35c; }
@media (prefers-color-scheme: dark) { :root { --bg:#161618; --fg:#f2f2f7; --muted:#98989f; --line:#3a3a3e; --accent:#6fbf7a; --warnbg:#2b2614; --warnline:#8a7330; } }
* { box-sizing:border-box; }
body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system, system-ui, sans-serif; }
main { max-width:680px; margin:0 auto; }
.banner { background:var(--warnbg); border:1px solid var(--warnline); border-radius:8px; padding:10px 12px; font-size:13.5px; margin-bottom:20px; }
h1 { font-size:24px; margin:0 0 2px; } .sub { color:var(--muted); margin:0 0 24px; }
h2 { font-size:18px; margin:28px 0 4px; } .req-note { color:var(--muted); font-size:13px; margin:0 0 8px; }
label { display:block; margin-top:16px; font-size:14px; font-weight:600; }
.req { color:#c62828; }
input, select, textarea { display:block; width:100%; margin-top:6px; padding:9px 10px; font:inherit; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:6px; }
textarea { min-height:110px; }
button { margin-top:26px; padding:10px 22px; font:inherit; font-weight:600; color:#fff; background:var(--accent); border:0; border-radius:6px; cursor:pointer; }
#done { margin-top:14px; font-weight:600; color:var(--accent); }
</style></head>
<body><main>
<div class="banner">Practice form from Job Pilot. Nothing here is sent anywhere, so it's safe to try /apply on it.</div>
<h1>Software Engineer</h1>
<p class="sub">Demo Co · Anywhere</p>
<form id="application">
<h2>Apply for this job</h2>
<p class="req-note"><span class="req">*</span> Indicates a required field</p>
<label for="first_name">First Name <span class="req">*</span></label><input id="first_name" name="first_name" required>
<label for="last_name">Last Name <span class="req">*</span></label><input id="last_name" name="last_name" required>
<label for="email">Email <span class="req">*</span></label><input id="email" name="email" type="email" required>
<label for="phone">Phone <span class="req">*</span></label><input id="phone" name="phone" type="tel" required>
<label for="location">Location (City) <span class="req">*</span></label><input id="location" name="location" required>
<label for="resume">Resume/CV <span class="req">*</span></label><input id="resume" name="resume" type="file" accept=".pdf,.doc,.docx" required>
<label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="linkedin" type="url">
<label for="company">Current company <span class="req">*</span></label><input id="company" name="company" required>
<label for="job_title">Current title <span class="req">*</span></label><input id="job_title" name="job_title" required>
<label for="country">Which country do you currently live in? <span class="req">*</span></label>
<select id="country" name="country" required><option value="">Select...</option>${countries}</select>
<label for="authorized">Are you legally authorized to work in the country of this job? <span class="req">*</span></label>
<select id="authorized" name="authorized" required>${yesNo}</select>
<label for="sponsorship">Will you now or in the future require visa sponsorship? <span class="req">*</span></label>
<select id="sponsorship" name="sponsorship" required>${yesNo}</select>
<label for="worked_here">Have you ever worked for Demo Co before? <span class="req">*</span></label>
<select id="worked_here" name="worked_here" required>${yesNo}</select>
<label for="heard_from">How did you hear about this job? <span class="req">*</span></label>
<select id="heard_from" name="heard_from" required><option value="">Select...</option><option>Company website</option><option>Referral</option><option>LinkedIn</option><option>Other</option></select>
<label for="cover_letter">Why do you want to work at Demo Co? <span class="req">*</span></label>
<textarea id="cover_letter" name="cover_letter" required></textarea>
<button type="submit">Submit application</button>
<div id="done" role="status"></div>
</form>
<script>
document.getElementById("application").addEventListener("submit", (e) => {
  e.preventDefault()
  document.getElementById("done").textContent = "Practice submit: nothing was sent. Tell Claude you submitted, or press I submitted on the board."
})
</script>
</main></body></html>
`
