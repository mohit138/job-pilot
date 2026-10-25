// HTML shared by the shortlist page and the board: escaping and the job card.
// Links are drawn only for http(s) URLs, so a feed can't plant javascript: links.

import { httpUrl } from "../portals/helpers.ts"
import type { StoredJob } from "../store.ts"

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

/** The job title, linked to its posting when the URL is http(s); plain text otherwise. */
export function jobLink(j: Pick<StoredJob, "url" | "title">): string {
  const url = httpUrl(j.url)
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(j.title)}</a>` : `<span>${esc(j.title)}</span>`
}

export function ago(at: string | undefined, now = Date.now()): string {
  if (!at) return ""
  const m = Math.round((now - new Date(at).getTime()) / 60000)
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

/** [status to move to, button label, css class] */
export type CardAction = readonly [string, string, string]

/** One job as a board card: score, linked title, company and location, rank note, latest step and buttons. */
export function jobCard(j: StoredJob, actions: readonly CardAction[] = [], showLast = false): string {
  const last = j.history.at(-1)
  const buttons = actions.map(([s, label, cls]) => `<button class="${cls}" data-id="${esc(j.id)}" data-s="${s}">${esc(label)}</button>`).join("")
  // "Ready for you" / "Your turn" means the user has something to do in that tab.
  const yours = /^(Ready for you|Your turn)/.test(last?.note ?? "")
  const live = showLast && last?.note ? `<div class="live${yours ? " you" : ""}">${esc(last.note)} <span class="when">· ${ago(last.at)}</span></div>` : ""
  return (
    `<div class="job"><div class="score">${j.score ?? "–"}</div><div><div class="t">${jobLink(j)}</div>` +
    `<div class="sub">${esc(j.company)}${j.location ? " · " + esc(j.location) : ""}</div>` +
    (j.rankNote ? `<div class="note">${esc(j.rankNote)}</div>` : "") +
    `${live}</div><div class="acts">${buttons}</div></div>`
  )
}
