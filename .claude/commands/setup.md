# /setup - Build your profile

Set up the private `me/` folder so /scrape, /rank and /apply know who the user is and what they want. Everything personal goes in `me/`, which git ignores.

1. If `me/` doesn't exist, run `bun run jp init`. It copies the fake examples from `example/` and switches on the privacy hook. `me/companies.json` starts empty: the user picks their own companies with `/add-company` (`me/companies.sample.json` only shows what entries look like; nothing reads it). If `me/` already existed and `me/companies.json` holds companies the user didn't add themselves (an older setup copied six samples: Adobe, Intuit, JPMC, Microsoft, Stripe, Swiggy), ask whether to keep them; remove unwanted ones with `bun run jp remove <company>`.
2. **Check before replacing.** Read `me/profile.md` and `me/answers.md`. If a file still has the sample's "FAKE example" line, it's safe to fill. If not, the user has already set it up: show a short summary of what's there and ask before changing it. When they agree, update it (add, correct, fill gaps) rather than rewriting it from scratch, and keep anything they wrote that the resume doesn't contradict.
3. Ask the user for their resume (a PDF path, or dragged into the chat). Copy it to `me/resume.pdf`, replacing the fake one. Read it.
4. Fill `me/profile.md` from the resume, keeping the example's headings and dropping the "FAKE example" line. Then ask only what the resume can't answer, in one message:
   - target roles and seniority
   - city, and whether remote or hybrid is fine
   - deal-breakers
   - skills they're strong in vs. still learning
5. Fill `me/answers.md` (the facts application forms ask for): contact details, notice period, current and expected CTC, work authorisation, education. Drop the "FAKE example" line but keep the note below it. Ask for anything missing. Never invent a value; leave a line out rather than guess. /apply fills forms only from these files, so anything left out is handed to the user to fill.
6. Fill `me/search.json`: `location`, 2-4 `queries` that match their target titles (short phrases such as "backend engineer"), and `excludeTitleWords` from their deal-breakers.
7. Show a short summary of what was written. Next step: "Add the companies you want with `/add-company <name> - <careers link>` (one per line for several), then say **find me jobs**."

Rules:
- Personal data goes only in `me/`. Never write it anywhere else in the repo, never commit `me/`.
- The examples in `example/` stay fake. Don't edit them with the user's details.
- Don't add companies on the user's behalf; `me/companies.json` holds only companies they chose.
