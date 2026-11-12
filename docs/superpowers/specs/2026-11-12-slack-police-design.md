# slack-police — design

*Status: draft for review · 2026-11-12 · working name taken from the project folder*

## 1. Intent

Small teams want every Slack profile to be complete and consistent: a real photo, a phone number people can actually dial, and a department from an agreed list. Today someone has to notice the gaps and chase people by hand.

slack-police is a small, self-hosted Slack bot that does the chasing. It checks everyone's profile against rules written in a YAML file. It DMs each person a single message listing what's missing and how to fix it, and keeps reminding them politely at a set interval until the profile is complete.

The author will run it on their own team first, then publish it as open source so other small teams can deploy it. That second audience shapes most of the design: strangers must be able to set it up from the README alone, it must work on Slack's Free plan, and teams on paid plans must be able to add rules for their own custom profile fields (such as Department).

## 2. Goals

1. **Rules come from a YAML file.** Out of the box: photo uploaded, phone in international format, and a field's value is one of an allowed list. Rules can target built-in profile fields on every Slack plan, and custom profile fields on paid plans.
2. **Scheduling is built into the app.** One long-running process, deployed once on the smallest available instance (256 MB RAM is enough). No GitHub Actions or external cron.
3. **Reminders that don't annoy people:**
   - One combined DM per person.
   - A minimum gap between reminders to the same person.
   - Optionally, DMs only during each person's local working hours.
4. **Precise targeting.** `only_users` and `exclude_users` lists work at the global level and on each rule.
5. **Fix and confirm in one place.** A **Check again** button in the DM re-checks the person immediately.
6. **Admin visibility.** An optional periodic summary in an admin channel shows who is still incomplete.
7. **Easy for a stranger to set up:**
   - Create the Slack app from the manifest in the repo.
   - Paste two tokens.
   - `docker run` with a config file.
   - The config is validated at startup, with errors that name the exact problem.
   - Dry-run is on by default, so a fresh install messages nobody.

## 3. Non-goals (v1)

- Editing profiles on people's behalf. This needs an admin user token and a paid plan.
- Escalating to managers or HR. The admin summary is the only escalation.
- Serving many workspaces from one deployment, or listing in the Slack Marketplace. One deployment serves one workspace.
- A web UI or dashboard.
- High availability or more than one replica.
- Enterprise Grid org-wide installs.
- Slack user groups (`@engineering`) inside `only_users` / `exclude_users`. This is a natural later addition.
- Reloading config while running. Changing the config requires a restart.

## 4. Anti-goals: failure even if it technically works

- **Nagging people into muting the bot.** Too many DMs, duplicate DMs, DMs at 3 a.m. local time, or a vague message that doesn't say how to fix the problem.
- **A typo that silently turns a rule off.** For example an empty `only_users: []`, a misspelled custom field label, or a mistyped email. These must either stop startup or log a clear warning.
- **Leaking profile data.** Phone numbers and other field values never appear in logs or in the admin channel. Only rule IDs and people's names or mentions do.
- **Needing infrastructure a small team doesn't have:** a public URL, TLS certificates, a database server, or a separate cron service.

## 5. Constraints and Slack API facts

All facts below were checked against docs.slack.dev on 2026-11-12.

| Need | Method | Scope | Rate limit | Notes |
|---|---|---|---|---|
| List everyone | `users.list` | `users:read` (+ `users:read.email` for emails) | Tier 2 (20+/min) | Cursor-paginated; use `limit=200`. Returns the built-in profile fields and the flags `deleted`, `is_bot`, `is_restricted`, `is_ultra_restricted`, `is_invited_user`, `is_stranger`, `tz`. **Does not return custom profile fields.** |
| Photo uploaded? | user object | — | — | `profile.is_custom_image` is documented as "Whether the user uploaded a custom profile image". |
| Custom field values | `users.profile.get` (one call per user) | `users.profile:read` | Tier 4 (100+/min) | `profile.fields` is keyed by field ID, e.g. `"Xf0111111": {"value": "...", "alt": ""}`. **Do not use `include_labels`**: the docs say it "will heavily rate-limit your requests". |
| Custom field definitions | `team.profile.get` | `users.profile:read` | Tier 3 (50+/min) | Each field has `id`, `label`, `type` (`text`, `long_text`, `date`, `link`, `options_list`, `tags`, `user`), `possible_values`, `is_hidden`, and `options.is_scim`. |
| Open the DM | `conversations.open` with `users=<U…>` | `im:write` | Tier 3 | Returns the `D…` channel ID. **Use this rather than posting to a `U…` ID.** The `chat.postMessage` docs contradict each other on where a `U…` post lands (App Home vs. the Slackbot DM). |
| Send / update a DM | `chat.postMessage`, `chat.update` | `chat:write` | ~1 msg/sec per channel; workspace cap of "several hundred per minute" | |
| Button clicks | Socket Mode `block_actions` | app-level token with `connections:write` | — | No public URL needed. |

Other constraints:

- **Tokens:** `SLACK_BOT_TOKEN` (`xoxb-…`) and `SLACK_APP_TOKEN` (`xapp-…`) come from environment variables, never from the YAML file.
- **Custom profile fields need a paid Slack plan.** A Free workspace has none, so `team.profile.get` returns an empty list.
- **SCIM-synced fields:** a field with `options.is_scim: true` is synced from an identity provider (Okta, Google, Entra…). People usually can't edit it in Slack, so reminding them is pointless.
- **One running copy only.** Two copies would send double reminders. Document this; don't engineer around it.
- **Target scale:** up to about 1,000 people per workspace.

## 6. Decisions

### Decided by the author

- Rules and settings live in a YAML file to start with.
- How often the bot runs is configurable.
- Example rules: every person has a photo; mobile number in international format; department is one of a fixed list (e.g. Engineering, Tech, …).
- The scheduler is built into the app. Deploy once on a small instance rather than running in GitHub Actions.
- Open source for other small teams: clean and configurable, with custom fields available to teams on paid plans.
- `only_users` / `exclude_users` at the global level and per rule, with the semantics in §7.4.
- The DM behaviour in §7.6: one combined message with a fix hint per rule, a **Check again** button, repeat reminders at the configured gap, and no escalation beyond the admin summary.
- The programming language was left to Claude.

### Claude's calls (open to change)

- **TypeScript on Node 24 LTS, using Slack's official Bolt SDK in Socket Mode.** Socket Mode makes an outbound WebSocket connection to Slack, so the bot needs no public URL. Bolt is Slack's best-supported SDK, and one event loop runs both the scheduler and the socket.
- **Custom fields are referenced by label** (`custom_field: "Department"`), resolved to IDs at startup through `team.profile.get`. This keeps one config portable across workspaces.
- **Built-in fields use `field:` and custom fields use `custom_field:`.** Two separate keys mean a custom field labelled "Title" can never be confused with the built-in title.
- **`only_users` / `exclude_users` accept Slack user IDs or email addresses.** Emails are resolved to IDs once per pass, from the `users.list` data the pass already fetches.
- **A small SQLite file in `DATA_DIR` holds reminder state.** If it's lost, the worst case is one extra reminder per person.
- **`dry_run` blocks DMs to people only.** Logs and the admin summary still happen; the summary is labelled "dry run — nobody was messaged". The example config ships with `dry_run: true`.
- **The admin channel is given by channel ID (`C…`), and the bot must be invited.** Accepting names would need an extra scope (`channels:read`).
- **If the instance is down at a scheduled time, there is no catch-up.** It simply waits for the next slot.
- **For an `options_list` custom field with no `values:` given, `one_of` uses Slack's own `possible_values`.**
- **Licence: MIT.**
- **The phone check is lenient by default** (`validation: possible`: right length for the country). Strict validity rejects real numbers from ranges newer than the library's bundled data, and a wrongly rejected person would be reminded every week forever, which is exactly what §4 warns against. Two options are available for teams that want more:
  - `validation: valid` (strict validity)
  - `mobile_only: true` (in countries where libphonenumber can't tell mobiles from landlines, such as the US and Canada, it accepts both)
- **`check` is a read-only report, and `start` is the only supported way to send reminders.** Under an external cron, the "Check again" button would have nothing listening, and running both could send duplicates.
- **The bot's display name defaults to "Profile Check"** in the manifest. Every employee sees it in their DMs, and "police" doesn't fit the polite tone. The repo, CLI and image keep the working name `slack-police`, and each team can rename the bot in the manifest.

## 7. How it works

### 7.1 Processes and entry points

One Node process with three commands:

- `slack-police start` (the Docker default): validates the config, connects Socket Mode, starts the schedules, and runs until stopped.
- `slack-police check`: a read-only report for trying a config. It evaluates **everyone** in global scope right now, ignoring the reminder gap and working hours, prints who fails which rule, and exits. It sends nothing and writes no state. It is not a way to run reminders from an external cron; only `start` sends reminders.
- `slack-police validate`: config and Slack resolution checks (§7.3), then exits non-zero on any error.

Environment variables:

- Required: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`.
- Optional: `CONFIG_PATH` (default `./config.yaml`), `DATA_DIR` (default `./data`), `LOG_LEVEL`, `HEALTH_PORT`.

If `HEALTH_PORT` is set, the bot serves `GET /healthz` for hosting platforms that require a listening port.

### 7.2 Configuration (full example)

```yaml
dry_run: true                    # log + admin summary only; no DMs to people. Set false when happy.

schedule:
  check: "0 * * * 1-5"           # cron for check passes (default: hourly on weekdays)
  timezone: "UTC"                # timezone for all cron expressions in this file

reminders:
  every: 7d                      # min gap between reminders to the same person (units: m, h, d, w)
  working_hours:                 # optional; evaluated in each person's own Slack time zone
    start: "09:00"
    end: "17:00"
    days: [mon, tue, wed, thu, fri]

scope:                           # who the bot looks at at all
  include_guests: false          # is_restricted / is_ultra_restricted
  exclude_users: [U01ABCDEF, ceo@example.com]
  # only_users: [you@example.com]   # pilot mode: only these people

rules:
  - id: photo
    field: photo
    check: required              # for photo: a custom image has been uploaded
    hint: "Upload a profile photo: click your avatar → Profile → Edit."

  - id: phone
    field: phone
    check: phone                 # international number starting with "+"
    validation: possible         # possible (right length; default) | valid (strict libphonenumber validity)
    mobile_only: false           # true = reject numbers libphonenumber identifies as landlines
    strict_e164: false           # true = exactly +<digits>, no spaces
    hint: "Add your mobile number in international format, e.g. +971 50 123 4567."
    exclude_users: [U02CONTRACTOR]

  - id: department               # paid plans only
    custom_field: "Department"   # custom profile field, by its label
    check: one_of
    values: [Engineering, Tech, Design, Operations]   # optional for options_list fields
    hint: "Set your Department to one of: {values}."

admin_report:                    # optional
  channel: C0123ABCDEF
  schedule: "0 9 * * 1"          # Mondays 09:00 (schedule.timezone)

messages:                        # optional overrides; defaults ship with the app
  intro: "Hi {first_name}! A few things are missing from your Slack profile:"
  footer: "I'll remind you every {every} until it's done."
  all_done: "✅ All set. Thanks for completing your profile!"
```

**Built-in fields** available to `field:`:

- `photo`
- `phone`
- `title`
- `display_name`
- `real_name`
- `pronouns`

**Check types:**

| Check | Passes when | Options |
|---|---|---|
| `required` | Value is non-empty after trimming. For `photo`: `is_custom_image` is true. | — |
| `phone` | Value starts with `+` and parses with libphonenumber as a *possible* number (default) or a *valid* one. | `validation` (`possible` \| `valid`, default `possible`), `mobile_only` (default false), `strict_e164` (default false) |
| `one_of` | Trimmed value matches one of `values`. | `values`, `case_sensitive` (default false) |
| `regex` | Value matches `pattern`. | `pattern` |

`{values}` in a hint expands to the allowed list. `{first_name}` and `{every}` are available in `messages`.

Validation rules:

- Unknown keys are errors.
- `rules[].id` must be unique.
- A rule needs exactly one of `field` or `custom_field`.
- Each check's required options must be present.
- An empty `only_users: []` is an error. A **missing** key means "everyone".
- Error messages name the path, e.g. `rules[2].values must be a non-empty list`.

### 7.3 Startup sequence

1. Load the YAML and validate it (§7.2). On any error, print every problem and exit.
2. Call `auth.test` and log the workspace name. Exit if the token is bad.
3. Call `team.profile.get` and resolve each `custom_field` label (case-insensitive) to its ID.
   - **The label isn't found:** error, listing the labels that do exist. If there are none, say custom fields need a paid Slack plan.
   - **The field is SCIM-synced (`options.is_scim`):** warn that people usually can't edit it in Slack.
   - **The field is hidden:** warn.
   - **`options_list` field, `one_of` with no `values`:** use `possible_values`.
   - **`options_list` field with `values` given:** warn about any value that isn't in `possible_values`.
4. Fetch `users.list` once and resolve the emails in every `only_users` / `exclude_users` list. Warn about entries that match nobody or a deactivated account.
5. Connect Socket Mode, register the button handler, and start the schedules. Log the next run time of each schedule.

### 7.4 Who gets checked by which rule

The bot builds the set of people in three steps.

**1. Always skipped,** whatever the config says:

- deactivated accounts (`deleted`)
- bots (`is_bot`)
- Slackbot (`USLACKBOT`)
- people who were invited but haven't joined (`is_invited_user`)
- external Slack Connect people (`is_stranger`)

**2. Global scope:**

- Guests are dropped unless `include_guests: true`.
- If `scope.only_users` is set, keep only those people.
- Then remove anyone in `scope.exclude_users`.

**3. Per rule:** each rule's own `only_users` / `exclude_users` narrows the global set further, in the same order: only first, then exclude.

So a rule's list can never add back someone the global scope removed. If someone appears in both lists at the same level, exclude wins. A person to whom no rule applies is never fetched or messaged.

### 7.5 A check pass

Runs on `schedule.check`. If a pass is still running when the next one is due, the new one is skipped.

1. Call `users.list` (paginated) and apply the global scope (§7.4).
2. **Find who is due.** A person is due when both hold:
   - They haven't been reminded within `reminders.every`. Someone never reminded is always due.
   - If `working_hours` is set, it is currently inside that window in their `tz`. Fall back to `schedule.timezone` if `tz` is missing.

   People who aren't due are skipped this pass without any further API calls.
3. For each due person:
   - If any rule that applies to them uses a custom field, call `users.profile.get` for them. Run these calls in sequence or with small concurrency. The SDK's built-in 429 retry handles rate limits.
   - Evaluate every rule that applies to them.
4. **Someone with failures:** unless `dry_run` is on, open the DM (`conversations.open`, with the channel cached in state) and post the reminder (§7.6). Record the reminder time, the reminder count, the channel, the message timestamp and the failing rule IDs.
5. **Someone with no failures:** mark them compliant in state and reset their reminder count. No message.
6. **One person's API error:** log it with the user ID and carry on. It never aborts the pass.
7. At the end, log a summary: in scope, due, checked, reminded, compliant, errors. The log contains no field values.

The first pass on a new install can mean many DMs at once. Slack's limits (1/sec per channel, several hundred per minute per workspace) are fine at our scale. The builder may add an optional `reminders.max_per_pass` throttle.

### 7.6 The reminder DM

Block Kit layout:

- **Intro line:** `messages.intro`, with the person's first name.
- **One bullet per failing rule**, using that rule's `hint`.
- **Footer:** sets expectations, e.g. "I'll remind you every 7 days until it's done."
- **A primary button, "Check again"**, with `action_id: check_again`.

Each reminder is a **new** message, so Slack notifies the person. Earlier reminders stay in the DM, and their buttons keep working.

The bot's App Home has the Messages tab enabled and read-only. People can read the bot's messages but not type to it, so no message handling is needed.

### 7.7 "Check again" button

1. Acknowledge the click immediately.
2. Re-fetch that one person (`users.info`, plus `users.profile.get` if a custom field is involved) and evaluate the rules that apply to them under the current config.
3. **All passing:** `chat.update` the clicked message to `messages.all_done`, and mark the person compliant in state.
4. **Still failing:** `chat.update` the message with the remaining bullets and a "Checked just now" note.
5. A click doesn't change the reminder schedule. The next reminder still follows `reminders.every`.
6. Clicks from the same person are debounced (about 10 s) so repeated clicking doesn't burn rate limit.

### 7.8 Admin summary

This runs on `admin_report.schedule`, separately from check passes. It evaluates **everyone** in global scope (not only those due) and sends no DMs. It posts to `admin_report.channel`:

- totals: in scope, complete, incomplete
- the failure count per rule
- the incomplete people as mentions, each with the IDs of the rules they fail, truncated with "…and N more"

It never includes field values. When `dry_run` is on, the post is labelled "dry run — nobody was messaged". If the bot isn't in the channel, the error log says to invite it.

### 7.9 State

One SQLite file at `DATA_DIR/state.db`, with a single table keyed by `user_id`:

- `last_reminded_at`
- `reminder_count`
- `dm_channel_id`
- `last_message_ts`
- `last_failures` (the failing rule IDs)
- `updated_at`

If the file is missing, it is created empty. Deployment docs mount `DATA_DIR` on a persistent volume, but losing it only means one extra reminder per person.

### 7.10 Slack app manifest

The repo ships a `manifest.yaml` for "Create app → From a manifest":

- **Display name:** "Profile Check". Teams can change it before creating the app.
- **Bot scopes:** `users:read`, `users:read.email`, `users.profile:read`, `chat:write`, `im:write`.
- **Socket Mode:** on.
- **Interactivity:** on.
- **App Home:** Messages tab on, read-only.
- **App-level token:** created by the user with `connections:write`. Their README step is copying it into `SLACK_APP_TOKEN`.

### 7.11 Logging and privacy

- Structured JSON logs.
- User IDs and rule IDs only; never phone numbers or field values, at any log level.
- Tokens are never logged.

## 8. Packaging and project hygiene

- **Docker image:** multi-stage build, runs as non-root, `/data` volume, `CMD ["start"]`. Published to GHCR on version tags.
- **Repo files:**
  - `docker-compose.example.yml`
  - `config.example.yaml`, with `dry_run: true` and a commented `only_users` for pilot mode
  - `manifest.yaml`
  - `LICENSE` (MIT)
- **README:**
  - what it does
  - five-step setup: create the app from the manifest → install it → copy the tokens → write the config (start in pilot / dry-run) → `docker run`
  - full config reference
  - FAQ: Free vs paid plans; SCIM-synced fields; finding user and channel IDs; why only one copy may run
- **CI (GitHub Actions):** lint, typecheck and tests on each push; image publish on tag.

## 9. Testing

- **Unit tests:**
  - config validation (a valid fixture plus one fixture per error type)
  - the scope matrix (global and per-rule only/exclude, exclude wins, never re-includes, emails and IDs)
  - each check type; for `phone`: spaces, a missing `+`, local-only numbers, junk, strict E.164, `possible` vs `valid`, and `mobile_only` on a landline
  - the working-hours window across time zones, including a DST change
  - cooldown arithmetic
- **Orchestration tests:** Slack access sits behind a small interface with a fake implementation. Tests assert exactly who gets DMed, who gets marked compliant, and that `dry_run` sends nothing to people.
- **Test environment (decided by the author):** the author's own workspace. It is on a paid plan, with an existing free-text "Department" custom field, so the Department rule is `one_of` with `values` from the config. Install the app there from the start with `dry_run: true` and `only_users: [<author>]`. Nobody else is messaged until the author switches it on.
- **Manual acceptance in that workspace:**
  1. `validate`
  2. `check` (read-only report)
  3. a pilot with `only_users: [me]` and `dry_run: false`, checking the DM and the button
  4. a full rollout

## 10. Risks to settle in the first build step

1. **`users.list` may not include `profile.is_custom_image`.** It's documented on the user object, but the `users.list` page doesn't mention it. Confirm on a real workspace. If it's missing, fall back to `users.profile.get` for the photo rule.
2. **The value format for `options_list` fields in `users.profile.get`.** The value is presumably the option's text. This **can't be confirmed in the author's workspace**, where Department is free text. Implement it defensively (compare the trimmed `value`, case-insensitively, against `possible_values`), cover it with fake-based tests, and say in the README that dropdown fields haven't been tested against a live workspace yet.
3. **The DM lands in the bot's Messages tab** (not the Slackbot DM) when sent via `conversations.open` + `chat.postMessage`.

## 11. Left to the builder

- Libraries for config validation, cron, SQLite, logging, phone parsing (any libphonenumber port) and duration parsing.
- Project layout and module boundaries, beyond keeping Slack access behind an interface.
- Exact Block Kit markup and wording of the default messages, within §7.6.
- Concurrency for `users.profile.get` calls, the debounce mechanism, and whether to add `max_per_pass`.
- The `/healthz` details.
