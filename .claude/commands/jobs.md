# /jobs - See and update your jobs

`$ARGUMENTS` may be empty, a status filter, or an action.

- Nothing, or a status such as `new`, `approved`, `applied`: run `bun run jp jobs` (with `-s <status>` when given) and show the table.
- `approve <ids>`, `skip <ids>`, `applied <ids>`: run `bun run jp set <ids> -s approved|skipped|applied`. Accept ids as printed in the table. If the user refers to jobs by row number or title, map them to ids from the last table you showed, and confirm the mapping in your reply.
- `show <id>`: run `bun run jp detail <id> --format plain` and summarise the role in a few lines.

Statuses: new → ranked → approved → applying → applied, or skipped / failed / closed. An applied job is never moved back without `--force`, and only when the user says it was a mistake.
