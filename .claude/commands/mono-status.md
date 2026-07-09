---
description: Show the cross-repo dashboard for the current mono branch
---

Run `pnpm mono:status` and present the result compactly. Flag anomalies with a
suggested action:

- commits not pushed upstream → suggest /mono-push
- upstream has commits we lack → suggest /mono-pull
- failing CI on a PR → offer to investigate: `gh --repo <ghRepo> pr checks <number>`
- pushed branch but no PR → suggest /mono-pr
- mono branch not pushed to origin → remind that teammates can't see the work

$ARGUMENTS
