# slack-police

A small, self-hosted Slack bot that keeps everyone's profile complete and consistent. It checks each person's profile against rules you write in a YAML file, DMs them one polite message listing what's missing and how to fix it, and reminds them at a set interval until they're done.

- Rules for built-in fields (photo, phone, title, …) on every Slack plan, and custom profile fields (like Department) on paid plans.
- One combined DM per person, with a **Check again** button that re-checks immediately.
- Reminders only during each person's local working hours, if you want.
- An optional weekly summary in an admin channel.
- No public URL, no database server, no external cron: one process, one SQLite file, Socket Mode.
- Dry-run by default, so a fresh install messages nobody.

The bot's display name in Slack is **Profile Check**; the package, CLI and Docker image are `slack-police`.

## Setup (five steps)

1. **Create the app from the manifest.** Go to [api.slack.com/apps](https://api.slack.com/apps) → _Create app_ → _From a manifest_, and paste [`manifest.yaml`](manifest.yaml). You can rename the bot before creating it.
2. **Install it to your workspace**, then create an **app-level token** with the `connections:write` scope (Basic Information → App-Level Tokens).
3. **Copy the two tokens** into a `.env` file (never into the YAML config):

   ```bash
   SLACK_BOT_TOKEN=xoxb-…   # OAuth & Permissions → Bot User OAuth Token
   SLACK_APP_TOKEN=xapp-…   # the app-level token from step 2
   ```

4. **Write `config.yaml`** from [`config.example.yaml`](config.example.yaml). Start safe: keep `dry_run: true` and set `scope.only_users: [you@example.com]` so only you are checked while you try it.
5. **Run it:**

   ```bash
   docker run --rm --env-file .env \
     -v "$PWD/config.yaml:/config/config.yaml:ro" \
     -v slack-police-data:/data \
     ghcr.io/OWNER/slack-police:latest
   ```

   Or with Docker Compose: copy [`docker-compose.example.yml`](docker-compose.example.yml), replace `OWNER`, and `docker compose up -d`.

Validate your config at any time without messaging anyone:

```bash
docker run --rm --env-file .env -v "$PWD/config.yaml:/config/config.yaml:ro" ghcr.io/OWNER/slack-police:latest validate
```

### Commands

| Command           | What it does                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `start` (default) | Validates the config, connects Socket Mode, runs the schedules, sends reminders. The only command that messages people.      |
| `check`           | Read-only report: who fails which rule, right now, ignoring reminder gaps and working hours. Sends nothing, writes no state. |
| `validate`        | Config and Slack resolution checks; exits non-zero on any problem.                                                           |

### Environment variables

| Variable          | Required    | Default                                           | Meaning                                                  |
| ----------------- | ----------- | ------------------------------------------------- | -------------------------------------------------------- |
| `SLACK_BOT_TOKEN` | yes         | —                                                 | Bot token (`xoxb-…`).                                    |
| `SLACK_APP_TOKEN` | for `start` | —                                                 | App-level token (`xapp-…`) with `connections:write`.     |
| `CONFIG_PATH`     | no          | `./config.yaml` (`/config/config.yaml` in Docker) | Path to the YAML config.                                 |
| `DATA_DIR`        | no          | `./data` (`/data` in Docker)                      | Where `state.db` lives. Mount it on a persistent volume. |
| `LOG_LEVEL`       | no          | `info`                                            | `debug`, `info`, `warn`, `error`.                        |
| `HEALTH_PORT`     | no          | unset                                             | If set, serves `GET /healthz` on that port.              |

## Config reference

Unknown keys are errors, and every error names the exact path (e.g. `rules[2].values`). An empty `only_users: []` is an error; a **missing** key means "everyone".

### Top level

| Key                       | Default                                                              | Meaning                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dry_run`                 | `true`                                                               | Log and post the admin summary, but send no DMs to people. The summary is labelled "dry run — nobody was messaged".                                                                                           |
| `schedule.check`          | `"0 * * * 1-5"`                                                      | Cron expression for check passes (hourly on weekdays).                                                                                                                                                        |
| `schedule.timezone`       | `"UTC"`                                                              | Time zone for every cron expression in the file, and the fallback for working hours.                                                                                                                          |
| `reminders.every`         | `"7d"`                                                               | Minimum gap between reminders to the same person. Units: `m`, `h`, `d`, `w` (e.g. `30m`, `12h`, `7d`, `2w`).                                                                                                  |
| `reminders.working_hours` | unset                                                                | Optional `{start, end, days}` window, evaluated in each person's own Slack time zone. `start`/`end` are 24-hour `HH:MM`, `start` before `end`; `days` is a list of `mon`…`sun`. The window is `[start, end)`. |
| `scope.include_guests`    | `false`                                                              | Include single- and multi-channel guests.                                                                                                                                                                     |
| `scope.only_users`        | everyone                                                             | Pilot mode: only these people (IDs or emails).                                                                                                                                                                |
| `scope.exclude_users`     | none                                                                 | Never check these people (IDs or emails). Exclude wins over only.                                                                                                                                             |
| `rules`                   | required                                                             | Non-empty list of rules (below).                                                                                                                                                                              |
| `admin_report.channel`    | unset                                                                | Channel **ID** (`C…`), not its name. The bot must be invited.                                                                                                                                                 |
| `admin_report.schedule`   | —                                                                    | Cron for the summary, e.g. `"0 9 * * 1"` (Mondays 09:00).                                                                                                                                                     |
| `messages.intro`          | `Hi {first_name}! A few things are missing from your Slack profile:` | DM intro. `{first_name}` is replaced.                                                                                                                                                                         |
| `messages.footer`         | `I'll remind you every {every} until it's done.`                     | DM footer. `{every}` is replaced (e.g. "7 days").                                                                                                                                                             |
| `messages.all_done`       | `✅ All set. Thanks for completing your profile!`                    | Shown when a "Check again" click finds everything fixed.                                                                                                                                                      |

### Rules

Each rule needs a unique `id`, exactly one of `field` / `custom_field`, a `check`, and a `hint` (the fix instruction shown in the DM). Optional `only_users` / `exclude_users` narrow the global scope further — a rule can never re-include someone the global scope removed.

**Built-in fields** (`field:`): `photo`, `phone`, `title`, `display_name`, `real_name`, `pronouns`.

**Custom fields** (`custom_field: "Department"`): referenced by label, resolved at startup via `team.profile.get`. Paid Slack plans only. Labels are matched case-insensitively; a missing label is a startup error listing the labels that exist.

| Check      | Passes when                                                                  | Options                                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `required` | Value is non-empty after trimming. For `photo`: a custom image was uploaded. | —                                                                                                                                                                                                                                                                                                                        |
| `phone`    | Starts with `+` and parses as a phone number.                                | `validation`: `possible` (default; right length for the country) or `valid` (strict). `mobile_only` (default `false`): reject numbers identified as landlines; in countries where mobiles can't be distinguished (US/Canada) both are accepted. `strict_e164` (default `false`): require exactly `+<digits>`, no spaces. |
| `one_of`   | Trimmed value is in `values`.                                                | `values` (required for built-in fields; optional for dropdown custom fields — Slack's own options are used then). `case_sensitive` (default `false`).                                                                                                                                                                    |
| `regex`    | Value matches `pattern`.                                                     | `pattern` (a JavaScript regular expression).                                                                                                                                                                                                                                                                             |

`{values}` in a hint expands to the allowed list, e.g. `Set your Department to one of: {values}.`

The phone check is lenient by default on purpose: strict validity can reject real numbers from ranges newer than the bundled metadata, and a wrongly rejected person would be reminded forever.

### Who gets checked

Always skipped: deactivated accounts, bots, Slackbot, invited-but-not-joined people, and external Slack Connect people. Guests are skipped unless `include_guests: true`. Then global `only_users`/`exclude_users` apply, then each rule's own lists. Emails are resolved to user IDs once per pass; entries that match nobody or a deactivated account produce a startup warning.

### State

One SQLite file at `DATA_DIR/state.db` holds reminder state (last reminder time, count, DM channel, last message). Losing it costs at most one extra reminder per person. Run **one copy only** — two copies send double reminders.

## FAQ

**Does it work on Slack's Free plan?**
Yes, for built-in fields. Custom profile fields (like Department) need a paid plan; on Free workspaces `team.profile.get` returns no fields and any `custom_field` rule fails validation with a clear message.

**What about SCIM-synced fields?**
Fields synced from an identity provider (Okta, Google, Entra…) usually can't be edited in Slack, so reminding people is pointless. The bot warns at startup when a rule targets a SCIM-synced field.

**How do I find user and channel IDs?**
User ID: profile → ⋯ → _Copy member ID_. Channel ID: channel name → _View channel details_ → bottom of the About tab. The admin channel must be given as an ID (`C…`), and you must invite the bot: `/invite @Profile Check`.

**Why may only one copy run?**
Reminder state is local to one process. Two copies would each remind people, doubling the DMs. There is no distributed lock by design — deploy one replica.

**Where do the DMs appear?**
In the **Profile Check** app's Messages tab (a DM channel opened with `conversations.open`), not the Slackbot DM. The tab is read-only: people read the bot's messages but can't type to it.

**Dropdown (`options_list`) custom fields** compare the trimmed value case-insensitively against the field's options. This path is covered by tests with fake data but **has not yet been tested against a live workspace** — report anything odd.

**Does `users.list` include the photo flag?**
The photo rule falls back to `users.profile.get` whenever `users.list` omits `is_custom_image`, so it works either way. (Live-workspace finding to be recorded here after the first deployment.)

## Development

```bash
bun install
bun run test      # vitest
bun run typecheck # tsc --noEmit
bun run lint      # oxlint + oxfmt --check
bun run format    # oxfmt --write
bun run build     # dist/
```

Node >= 24 at runtime; [Bun](https://bun.sh) is the package manager and script runner.
Linting and formatting use the OXC tools (`oxlint`, `oxfmt`). Licence: MIT.
