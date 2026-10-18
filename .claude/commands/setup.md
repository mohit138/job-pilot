# /setup - Build your profile

Set up the private `me/` folder so /scrape, /rank and /apply know who the user is and what they want.

1. If `me/` doesn't exist, run `bun run jp init`. It copies the fake examples from `example/` and switches on the privacy hook.
2. Ask the user for their resume (a PDF path, or dragged into the chat). Copy it to `me/resume.pdf`, replacing the fake one. Read it.
3. Fill `me/profile.md` from the resume, keeping the example's headings. Then ask only what the resume can't answer, in one message:
   - target roles and seniority
   - city, and whether remote or hybrid is fine
   - deal-breakers
   - skills they're strong in vs. still learning
4. Fill `me/answers.md` (the facts application forms ask for): contact details, notice period, current and expected CTC, work authorisation, education. Ask for anything missing. Never invent a value; leave a line out rather than guess.
5. Fill `me/search.json`: `location`, 2-4 `queries` that match their target titles (short phrases such as "backend engineer"), and `excludeTitleWords` from their deal-breakers.
6. Show a short summary of what was written and suggest `/add-company` next.

Rules:
- Personal data goes only in `me/`. Never write it anywhere else in the repo, never commit `me/`.
- The examples in `example/` stay fake. Don't edit them with the user's details.
