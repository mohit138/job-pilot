# /board - Open the live jobs page

Start the jobs page in the background, so it doesn't hold up the chat: `curl -s http://127.0.0.1:4317/api/board > /dev/null || (nohup bun run jp board > /tmp/jp-board.log 2>&1 &)` (add `--min N` after `board` to change the score cut-off; default 60). Then give the user the link, http://127.0.0.1:4317. If the port is busy, the page is probably already running; just give the link.

The page runs only on this machine. It shows the shortlist, the approved queue, the job being applied to right now (with each step /apply records), and jobs already applied to. It re-reads `me/jobs.json` every 2 seconds, so it follows along while /apply works.

Its buttons:
- **Approve** / **Skip** on shortlisted jobs
- **Un-approve** on approved jobs (back to the shortlist)
- **Back to shortlist** on skipped jobs
- **Retry** / **Skip** on jobs whose application failed ("Needs a look")
- for the job being applied to: **I submitted** (press it once you've pressed submit on the company's site; the job is recorded as applied for good) and **Later** (puts it back in the approved queue)

Nothing on the page fills or submits an application; that's /apply filling and you submitting.
