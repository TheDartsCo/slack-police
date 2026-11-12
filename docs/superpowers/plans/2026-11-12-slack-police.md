# slack-police Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted Slack bot that checks every profile against YAML rules on an in-app schedule and DMs people what to fix, with a "Check again" button and an optional admin summary.

**Architecture:** One long-running Node process.
- **Bolt (Socket Mode):** receives button clicks.
- **croner:** runs the check pass and the admin report.
- **Pure modules:** config, checks, scope, time, rule evaluation and message building. They are unit-tested.
- **The Slack seam:** every Slack call goes through one `SlackDirectory` interface. A fake of it drives the orchestration tests.
- **State:** a single SQLite file holds reminder state.

**Tech Stack:**

| Purpose | Library |
|---|---|
| Runtime | Node 24 LTS, TypeScript (strict, ESM / NodeNext) |
| Slack | `@slack/bolt`, `@slack/web-api` |
| Config | `zod`, `yaml` |
| Scheduling | `croner` |
| State | `better-sqlite3` |
| Phone numbers | `libphonenumber-js` (the `/max` metadata) |
| Logging | `pino` |
| Tests | `vitest` |
| Lint / format | `@biomejs/biome` |

**Spec:** `docs/superpowers/specs/2026-11-12-slack-police-design.md` (read it alongside this plan).

## Global Constraints

- **Runtime and modules:** Node `>=24`; TypeScript `strict`; ESM, with `.js` extensions in relative imports (NodeNext).
- **Environment variables:**
  - Required: `SLACK_BOT_TOKEN` (`xoxb-…`) and `SLACK_APP_TOKEN` (`xapp-…`).
  - Optional: `CONFIG_PATH` (default `./config.yaml`), `DATA_DIR` (default `./data`), `LOG_LEVEL` (default `info`), `HEALTH_PORT`.
  - Tokens never appear in YAML.
- **Bot scopes, exactly:** `users:read`, `users:read.email`, `users.profile:read`, `chat:write`, `im:write`. The app-level token uses `connections:write`.
- **What may appear in logs and Slack posts:** user IDs, rule IDs and names/mentions only. Never field values (phone numbers, etc.) and never tokens, at any log level.
- **`users.list`:** always `limit: 200` with cursor pagination.
- **`users.profile.get`:** never pass `include_labels`.
- **DMs:** `conversations.open` gives a `D…` channel and you post there. Never post to a `U…` ID.
- **Names:** the bot's display name is `Profile Check`. The package, CLI and image are `slack-police`. Licence MIT.
- **Default copy (exact):**
  - intro: `Hi {first_name}! A few things are missing from your Slack profile:`
  - footer: `I'll remind you every {every} until it's done.`
  - all_done: `✅ All set. Thanks for completing your profile!`
  - button: `Check again`
  - note: `Checked just now`
  - dry-run label: `dry run — nobody was messaged`
- **Config defaults:**
  - `dry_run: true`
  - `schedule.check: "0 * * * 1-5"`, `schedule.timezone: "UTC"`
  - `reminders.every: "7d"`
  - `scope.include_guests: false`
  - phone: `validation: possible`, `mobile_only: false`, `strict_e164: false`
  - `one_of.case_sensitive: false`
- **Deviation from spec §10:** the spec put the live checks (risks 1 and 3) first. They move to Task 14 because:
  - The photo rule falls back to `users.profile.get` whenever `users.list` omits `is_custom_image` (Tasks 6 and 9), so the answer to risk 1 doesn't change the build.
  - The checks need the author's tokens.

## Review Focus

1. **A Slack `tz` that is missing or not a valid IANA zone** → working hours use `schedule.timezone` and the pass carries on (Task 9).
2. **Phone numbers as people really type them.**
   - `"00971 50 123 4567"` fails (no `+`).
   - `"+971-50-123-4567"`, `"+971 (50) 123-4567"` and trailing spaces pass unless `strict_e164` (Task 3).
3. **Broken YAML** (tab indentation, unclosed quote) → a `ConfigError` naming the line, never a stack trace (Task 2).
4. **An admin channel the bot was never invited to** → a log line telling the admin to invite the bot; the process keeps running (Task 11).
5. **"Check again" clicked on an old reminder after a config change excluded that person** → the message updates to all-done, nothing crashes (Task 10).

---

## File Map

```
package.json  tsconfig.json  tsconfig.build.json  biome.json  .gitignore
src/
  bin.ts                     entry: calls main()
  cli.ts                     main(): start | check | validate
  env.ts                     readEnv()
  log.ts                     Logger type + createLogger()
  health.ts                  startHealthServer()
  time/duration.ts           parseDuration(), describeDuration()
  time/zones.ts              Weekday, WorkingHours, isValidTimeZone(), localTime(), isWithinWorkingHours()
  config/schema.ts           zod schema + Config types
  config/load.ts             ConfigError, parseConfigText(), loadConfig(), formatIssuePath()
  rules/checks.ts            ResolvedCheck, runCheck()
  rules/prepare.ts           PreparedRule, prepareRules()
  rules/evaluate.ts          RuleFailure, fieldValue(), needsProfileFetch(), evaluateRules()
  slack/types.ts             SlackUser, UserProfile, CustomFieldDef, SlackMessage, SlackDirectory
  slack/web-directory.ts     mapUser(), mapFieldDef(), WebSlackDirectory
  slack/errors.ts            slackErrorCode()
  scope/scope.ts             indexUsers(), resolveRefs(), isBaselineEligible(), inGlobalScope(), inScope()
  state/store.ts             PersonState, StateStore, openStateStore(), isDue()
  messages/reminder.ts       renderTemplate(), escapeText(), buildReminder(), buildStillMissing(), buildAllDone()
  messages/report.ts         ComplianceSummary, buildAdminReport(), formatCheckReport()
  app/deps.ts                AppDeps
  app/assess.ts              buildPopulation(), applicableRules(), assessUser()
  app/pass.ts                runCheckPass()
  app/check-again.ts         createCheckAgainHandler()
  app/report.ts              summarizeCompliance(), runAdminReport()
  app/bootstrap.ts           bootstrap()
  app/start.ts               startApp()
tests/  (mirrors src/; tests/support/ holds FakeSlackDirectory and spyLogger)
manifest.yaml  config.example.yaml  Dockerfile  .dockerignore  docker-compose.example.yml
.github/workflows/ci.yml  .github/workflows/release.yml  README.md  LICENSE
```

---

### Task 1: Project scaffold and time helpers

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `biome.json`, `.gitignore`
- Create: `src/time/duration.ts`, `src/time/zones.ts`
- Test: `tests/time/duration.test.ts`, `tests/time/zones.test.ts`

**Interfaces:**
- Produces:
  - `parseDuration(input: string): number` (ms; throws)
  - `describeDuration(input: string): string`
  - `type Weekday = 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'`
  - `type WorkingHours = { start: string; end: string; days: Weekday[] }`
  - `isValidTimeZone(tz: string): boolean`
  - `localTime(now: Date, timeZone: string): { weekday: Weekday; minutes: number }`
  - `isWithinWorkingHours(now: Date, timeZone: string, wh: WorkingHours): boolean`

- [ ] **Step 1: Initialise the repo and tooling**
  1. `git init`.
  2. Run `npm init -y`, then set these fields:
     - `"name": "slack-police"`, `"type": "module"`, `"license": "MIT"`
     - `"engines": {"node": ">=24"}`
     - `"bin": {"slack-police": "dist/bin.js"}`
     - scripts: `build: tsc -p tsconfig.build.json`, `typecheck: tsc --noEmit`, `lint: biome check .`, `test: vitest run`
  3. Install the runtime dependencies (current versions):
     ```bash
     npm i @slack/bolt @slack/web-api zod yaml croner better-sqlite3 libphonenumber-js pino
     ```
  4. Install the dev dependencies:
     ```bash
     npm i -D typescript vitest @biomejs/biome @types/node @types/better-sqlite3
     ```
  5. `tsconfig.json`: `target ES2023`, `module/moduleResolution NodeNext`, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `skipLibCheck`, `noEmit`, `include ["src","tests"]`.
  6. `tsconfig.build.json`: extends `tsconfig.json`, with `noEmit false`, `rootDir src`, `outDir dist`, `include ["src"]`.
  7. Run `npx @biomejs/biome init`, then set `vcs.useIgnoreFile: true`.
  8. `.gitignore`: `node_modules/`, `dist/`, `data/`, `config.yaml`, `.env`.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/time/duration.test.ts
it.each([['30m', 1_800_000], ['12h', 43_200_000], ['7d', 604_800_000], ['2w', 1_209_600_000]])(
  'parseDuration(%s)', (s, ms) => expect(parseDuration(s)).toBe(ms));
it.each(['7', 'd', '0d', '1.5d', ' 7d', '7 days'])('rejects %s', (s) =>
  expect(() => parseDuration(s)).toThrow(`invalid duration "${s}" (use e.g. 30m, 12h, 7d, 2w)`));
it.each([['7d', '7 days'], ['1w', 'week'], ['1d', 'day'], ['12h', '12 hours'], ['30m', '30 minutes'], ['2w', '2 weeks']])(
  'describeDuration(%s)', (s, text) => expect(describeDuration(s)).toBe(text));

// tests/time/zones.test.ts
const wh = { start: '09:00', end: '17:00', days: ['mon','tue','wed','thu','fri'] } as const;
it('Dubai Thursday 09:30 is inside', () => expect(isWithinWorkingHours(new Date('2026-11-12T05:30:00Z'), 'Asia/Dubai', wh)).toBe(true));
it('Dubai 08:59 is outside', () => expect(isWithinWorkingHours(new Date('2026-11-12T04:59:00Z'), 'Asia/Dubai', wh)).toBe(false));
it('end is exclusive (17:00)', () => expect(isWithinWorkingHours(new Date('2026-11-12T13:00:00Z'), 'Asia/Dubai', wh)).toBe(false));
it('Saturday is outside', () => expect(isWithinWorkingHours(new Date('2026-11-14T08:00:00Z'), 'Asia/Dubai', wh)).toBe(false));
it('LA uses its own date: Thu 17:00 PST', () => expect(isWithinWorkingHours(new Date('2026-11-13T01:00:00Z'), 'America/Los_Angeles', wh)).toBe(false));
it('LA Thu 09:30 PST', () => expect(isWithinWorkingHours(new Date('2026-11-12T17:30:00Z'), 'America/Los_Angeles', wh)).toBe(true));
it('London after DST starts (Mon 09:30 BST)', () => expect(isWithinWorkingHours(new Date('2026-03-30T08:30:00Z'), 'Europe/London', wh)).toBe(true));
it('London before DST (Fri 08:30 GMT)', () => expect(isWithinWorkingHours(new Date('2026-03-27T08:30:00Z'), 'Europe/London', wh)).toBe(false));
it('localTime', () => expect(localTime(new Date('2026-11-12T05:30:00Z'), 'Asia/Dubai')).toEqual({ weekday: 'thu', minutes: 570 }));
it('time zone validity', () => { expect(isValidTimeZone('Asia/Dubai')).toBe(true); expect(isValidTimeZone('Mars/Base')).toBe(false); });
```

- [ ] **Step 3: Run the tests to verify they fail.** Run `npx vitest run tests/time`. Expected: FAIL, because the modules aren't found.

- [ ] **Step 4: Implement `src/time/duration.ts` and `src/time/zones.ts`**
  - **`parseDuration`:** matches `^(\d+)([mhdw])$`, where n must be > 0.
  - **`describeDuration`:** gives the bare unit when n = 1 (`week`), otherwise `n units`.
  - **`localTime`:** use `Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts`.
  - **The working-hours window is `[start, end)`.**
  - **`isValidTimeZone`:** try to construct the formatter and catch the error.

- [ ] **Step 5: Run the tests to verify they pass.** Run `npx vitest run tests/time`. Expected: PASS. Then `npm run typecheck && npm run lint` exits 0.

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "chore: scaffold project; add duration and time-zone helpers"
```

---

### Task 2: Config schema and loader

**Files:**
- Create: `src/config/schema.ts`, `src/config/load.ts`
- Test: `tests/config/load.test.ts`

**Interfaces:**
- Consumes: `parseDuration`, `isValidTimeZone`, `Weekday`, `WorkingHours` (Task 1); `Cron` from `croner`.
- Produces:
  - `BUILTIN_FIELDS = ['photo','phone','title','display_name','real_name','pronouns'] as const`
  - `type BuiltinField`
  - `type CheckSpec` (a union on `check`):
    - `{check:'required'}`
    - `{check:'phone'; validation:'possible'|'valid'; mobile_only:boolean; strict_e164:boolean}`
    - `{check:'one_of'; values?: string[]; case_sensitive:boolean}`
    - `{check:'regex'; pattern:string}`
  - `type RuleConfig = { id: string; field?: BuiltinField; custom_field?: string; hint: string; only_users?: string[]; exclude_users?: string[] } & CheckSpec`
  - `type MessagesConfig = { intro: string; footer: string; all_done: string }`
  - `DEFAULT_MESSAGES: MessagesConfig` (the exact default copy from Global Constraints; the schema defaults use it)
  - `type Config`, matching spec §7.2 with the Global Constraints defaults. It has keys `dry_run`, `schedule{check,timezone}`, `reminders{every, working_hours?}`, `scope{include_guests, only_users?, exclude_users?}`, `rules`, `admin_report?{channel,schedule}`, `messages`.
  - `class ConfigError extends Error { problems: string[] }`
  - `parseConfigText(text: string): Config`
  - `loadConfig(path: string): Promise<Config>`
  - `formatIssuePath(path: PropertyKey[]): string`

- [ ] **Step 1: Write the failing tests.** A helper `problems(yaml)` returns `ConfigError.problems` from `parseConfigText`.

```ts
const minimal = `rules:\n  - id: photo\n    field: photo\n    check: required\n    hint: Upload a photo`;
it('applies defaults', () => {
  const c = parseConfigText(minimal);
  expect(c.dry_run).toBe(true);
  expect(c.schedule).toEqual({ check: '0 * * * 1-5', timezone: 'UTC' });
  expect(c.reminders.every).toBe('7d');
  expect(c.scope.include_guests).toBe(false);
  expect(c.messages.intro).toBe('Hi {first_name}! A few things are missing from your Slack profile:');
  expect(c.admin_report).toBeUndefined();
});
it('phone and one_of defaults', () => { /* phone rule → validation 'possible', mobile_only false, strict_e164 false; one_of → case_sensitive false */ });
it('parses the spec §7.2 example', () => { /* paste the §7.2 YAML verbatim; expect no throw and rules.length 3 */ });
it('formatIssuePath', () => expect(formatIssuePath(['rules', 2, 'values'])).toBe('rules[2].values'));
it.each([
  ['unknown key',        `rules:\n  - {id: a, field: photo, check: required, hint: h, colour: red}`, (p: string) => p.startsWith('rules[0]') && p.includes('colour')],
  ['duplicate id',       `rules:\n  - {id: a, field: photo, check: required, hint: h}\n  - {id: a, field: title, check: required, hint: h}`, 'rules[1].id: duplicate rule id "a"'],
  ['both field kinds',   `rules:\n  - {id: a, field: title, custom_field: Dept, check: required, hint: h}`, 'rules[0]: set exactly one of field or custom_field'],
  ['no field',           `rules:\n  - {id: a, check: required, hint: h}`, 'rules[0]: set exactly one of field or custom_field'],
  ['photo non-required', `rules:\n  - {id: a, field: photo, check: phone, hint: h}`, 'rules[0].check: the photo field only supports check: required'],
  ['builtin one_of',     `rules:\n  - {id: a, field: title, check: one_of, hint: h}`, 'rules[0].values: required for built-in fields'],
  ['empty values',       `rules:\n  - {id: a, custom_field: Dept, check: one_of, values: [], hint: h}`, 'rules[0].values: must be a non-empty list'],
  ['empty global only',  `scope: {only_users: []}\n${minimal}`, 'scope.only_users: must be a non-empty list (remove the key to mean everyone)'],
  ['empty rule only',    `rules:\n  - {id: a, field: photo, check: required, hint: h, only_users: []}`, 'rules[0].only_users: must be a non-empty list (remove the key to mean everyone)'],
  ['bad cron',           `schedule: {check: every hour}\n${minimal}`, 'schedule.check: invalid cron expression "every hour"'],
  ['bad timezone',       `schedule: {timezone: Mars/Base}\n${minimal}`, 'schedule.timezone: unknown time zone "Mars/Base"'],
  ['bad duration',       `reminders: {every: "7"}\n${minimal}`, 'reminders.every: invalid duration "7" (use e.g. 30m, 12h, 7d, 2w)'],
  ['bad HH:MM',          `reminders: {working_hours: {start: 9am, end: "17:00", days: [mon]}}\n${minimal}`, 'reminders.working_hours.start: use 24-hour HH:MM'],
  ['start >= end',       `reminders: {working_hours: {start: "17:00", end: "09:00", days: [mon]}}\n${minimal}`, 'reminders.working_hours: start must be before end'],
  ['bad regex',          `rules:\n  - {id: a, field: title, check: regex, pattern: "(", hint: h}`, 'rules[0].pattern: invalid regular expression'],
  ['channel name',       `admin_report: {channel: "#ops", schedule: "0 9 * * 1"}\n${minimal}`, 'admin_report.channel: use the channel ID (starts with C), not its name'],
  ['no rules',           `rules: []`, 'rules: must be a non-empty list'],
])('%s', (_, yaml, expected) => {
  const ps = problems(yaml);
  typeof expected === 'string' ? expect(ps).toContain(expected) : expect(ps.some(expected)).toBe(true);
});
it('reports several field problems together', () =>
  expect(problems(`schedule: {timezone: Mars/Base}\nreminders: {every: "7"}\n${minimal}`)).toHaveLength(2));
it('broken YAML names the line (Review Focus 3)', () => {
  expect(problems('rules:\n\t- id: a')[0]).toMatch(/line \d+/);
  expect(problems('rules:\n  - id: "a\n')[0]).toMatch(/line \d+/);
});
it('missing file', async () => {
  await expect(loadConfig('/nope.yaml')).rejects.toMatchObject({ problems: ['config file not found: /nope.yaml'] });
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/config`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/config/schema.ts` and `src/config/load.ts`**
  - **Objects:** use `z.strictObject` everywhere.
  - **Rules:** a discriminated union on `check`, built from a shared base.
  - **Field-level checks** go in each field's own refinement, so several are reported in one go: cron (`new Cron(expr, { paused: true })` inside a try), time zone, duration, `HH:MM`, regex compiles, channel `^[CG][A-Z0-9]+$`, non-empty lists.
  - **Cross-field checks** go in one `superRefine` on the root: unique ids, exactly one of `field`/`custom_field`, photo ⇒ `required`, built-in `one_of` ⇒ `values`, start < end.
  - **YAML:** parse with `parseDocument`. If `doc.errors` isn't empty, throw `ConfigError` with `line N: <message>` taken from `linePos`.
  - **Problem format:** `` `${formatIssuePath(path)}: ${message}` ``. A root-level issue uses just the message.

- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/config`. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: YAML config schema with path-named validation errors"
```

---

### Task 3: Field checks

**Files:**
- Create: `src/rules/checks.ts`
- Test: `tests/rules/checks.test.ts`

**Interfaces:**
- Produces:
  - `type FieldValue = string | boolean | undefined`
  - `type ResolvedCheck`: the same as `CheckSpec`, except `one_of.values: string[]` is required
  - `runCheck(check: ResolvedCheck, value: FieldValue): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
const phone = (o = {}) => ({ check: 'phone', validation: 'possible', mobile_only: false, strict_e164: false, ...o }) as const;
it.each([[true, true], [false, false], [undefined, false], ['  ', false], ['x', true]])(
  'required(%s) → %s', (v, ok) => expect(runCheck({ check: 'required' }, v)).toBe(ok));
it.each([
  ['+971 50 123 4567', true], ['+971501234567', true], ['+971-50-123-4567', true], ['+971 (50) 123-4567', true],
  [' +971501234567 ', true], ['0501234567', false], ['00971 50 123 4567', false], ['', false], ['call me', false], ['+12', false],
])('phone default %s → %s (Review Focus 2)', (v, ok) => expect(runCheck(phone(), v)).toBe(ok));
it('strict_e164', () => {
  expect(runCheck(phone({ strict_e164: true }), '+971501234567')).toBe(true);
  expect(runCheck(phone({ strict_e164: true }), '+971 50 123 4567')).toBe(false);
});
// '+1 123 456 7890' should be possible but not valid. If libphonenumber disagrees, substitute any number
// with isPossible() && !isValid() and keep both assertions.
it('possible vs valid', () => {
  expect(runCheck(phone(), '+1 123 456 7890')).toBe(true);
  expect(runCheck(phone({ validation: 'valid' }), '+1 123 456 7890')).toBe(false);
});
it('mobile_only rejects only identified landlines', () => {
  expect(runCheck(phone({ mobile_only: true }), '+971 50 123 4567')).toBe(true);   // UAE mobile
  expect(runCheck(phone({ mobile_only: true }), '+971 2 234 5678')).toBe(false);   // UAE fixed line
  expect(runCheck(phone(), '+971 2 234 5678')).toBe(true);
  expect(runCheck(phone({ mobile_only: true }), '+1 201 555 0123')).toBe(true);    // FIXED_LINE_OR_MOBILE
});
const oneOf = (o = {}) => ({ check: 'one_of', values: ['Engineering', 'Tech'], case_sensitive: false, ...o }) as const;
it.each([['Engineering', true], ['engineering ', true], ['Sales', false], ['', false], [undefined, false]])(
  'one_of %s → %s', (v, ok) => expect(runCheck(oneOf(), v)).toBe(ok));
it('one_of case_sensitive', () => expect(runCheck(oneOf({ case_sensitive: true }), 'engineering')).toBe(false));
it('regex', () => {
  const r = { check: 'regex', pattern: '^[A-Z]' } as const;
  expect(runCheck(r, 'Alice')).toBe(true); expect(runCheck(r, 'alice')).toBe(false); expect(runCheck(r, undefined)).toBe(false);
});
it('string checks fail on booleans', () => expect(runCheck(oneOf(), true)).toBe(false));
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/rules/checks.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `runCheck` in `src/rules/checks.ts`**
  - Trim string values first.
  - **phone:**
    - The value must start with `+`.
    - `strict_e164` uses `^\+[1-9]\d{6,14}$`.
    - Otherwise use `parsePhoneNumberFromString` from `libphonenumber-js/max`, then `isPossible()` or `isValid()`.
    - `mobile_only` rejects only `getType() === 'FIXED_LINE'`.

- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/rules/checks.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: required, phone, one_of and regex checks"
```

---

### Task 4: Slack directory (types, Web API implementation, test fake)

**Files:**
- Create: `src/slack/types.ts`, `src/slack/web-directory.ts`
- Create: `tests/support/fake-directory.ts`
- Test: `tests/slack/web-directory.test.ts`

**Interfaces:**
- Produces, in `src/slack/types.ts`:
  - `type UserProfile = { hasCustomImage: boolean | undefined; phone: string; title: string; displayName: string; realName: string; pronouns: string; customFields: Record<string, string> }`. `customFields` maps field ID → value and is `{}` when the user came from `users.list`.
  - `type SlackUser = { id: string; deleted: boolean; isBot: boolean; isRestricted: boolean; isUltraRestricted: boolean; isInvitedUser: boolean; isStranger: boolean; tz: string | undefined; email: string | undefined; firstName: string; profile: UserProfile }`
  - `type CustomFieldDef = { id: string; label: string; type: string; possibleValues: string[]; isHidden: boolean; isScim: boolean }`
  - `type SlackMessage = { text: string; blocks: KnownBlock[] }` (`KnownBlock` from `@slack/bolt`)
  - `interface SlackDirectory` with these methods:
    - `authTest(): Promise<{ teamName: string }>`
    - `listUsers(): Promise<SlackUser[]>`
    - `getUser(userId: string): Promise<SlackUser>`
    - `getProfile(userId: string): Promise<{ hasCustomImage: boolean | undefined; customFields: Record<string, string> }>`
    - `listCustomFields(): Promise<CustomFieldDef[]>`
    - `openDm(userId: string): Promise<string>`
    - `postMessage(channel: string, msg: SlackMessage): Promise<{ ts: string }>`
    - `updateMessage(channel: string, ts: string, msg: SlackMessage): Promise<void>`
- Produces, in `src/slack/web-directory.ts`:
  - `mapUser(raw): SlackUser`
  - `mapFieldDef(raw): CustomFieldDef`
  - `class WebSlackDirectory implements SlackDirectory { constructor(client: WebClient) }`
- Produces, in `tests/support/fake-directory.ts`:
  - `makeUser(o: { id: string } & Partial<Omit<SlackUser,'profile'>> & { profile?: Partial<UserProfile> }): SlackUser`. Its defaults make a normal, compliant-looking member: all flags false, `tz 'UTC'`, `firstName 'Test'`, `hasCustomImage true`, `phone '+971501234567'`.
  - `class FakeSlackDirectory implements SlackDirectory` with these public fields:
    - `teamName = 'Acme'`, `authError?: unknown` (`authTest` rejects with it when set)
    - `users: SlackUser[]`, `fields: CustomFieldDef[]`
    - `profiles: Map<string, Record<string,string>>`
    - `failProfileFor: Set<string>`
    - `getProfileCalls: string[]`, `getUserCalls: string[]`, `openDmCalls: string[]`
    - `posted: {channel: string; msg: SlackMessage}[]`
    - `updated: {channel: string; ts: string; msg: SlackMessage}[]`
    - `postError?: unknown`
  - `openDm` returns `` `D${userId}` ``; `postMessage` returns `ts` values `'1.0'`, `'2.0'`, …

- [ ] **Step 1: Write the failing tests.** Fixtures are trimmed versions of the docs' example shapes.

```ts
const member = { id: 'U1', deleted: false, is_bot: false, is_restricted: false, is_ultra_restricted: false, tz: 'Asia/Dubai',
  profile: { first_name: 'Sara', real_name: 'Sara Ali', display_name: 'sara', phone: '+971501234567', title: 'Dev',
             pronouns: 'she/her', email: 'sara@example.com', is_custom_image: true } };
it('mapUser', () => expect(mapUser(member)).toEqual({ id: 'U1', deleted: false, isBot: false, isRestricted: false,
  isUltraRestricted: false, isInvitedUser: false, isStranger: false, tz: 'Asia/Dubai', email: 'sara@example.com', firstName: 'Sara',
  profile: { hasCustomImage: true, phone: '+971501234567', title: 'Dev', displayName: 'sara', realName: 'Sara Ali', pronouns: 'she/her', customFields: {} } }));
it('firstName falls back to real_name word, then display_name, then "there"', () => { /* three cases → 'Sara', 'sara', 'there' */ });
it('missing is_custom_image stays undefined', () => { /* delete profile.is_custom_image → hasCustomImage undefined */ });
it('listUsers paginates with limit 200', async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ members: [member], response_metadata: { next_cursor: 'c2' } })
    .mockResolvedValueOnce({ members: [{ ...member, id: 'U2' }], response_metadata: { next_cursor: '' } });
  const dir = new WebSlackDirectory({ users: { list } } as unknown as WebClient);
  expect((await dir.listUsers()).map((u) => u.id)).toEqual(['U1', 'U2']);
  expect(list.mock.calls.map((c) => c[0])).toEqual([{ limit: 200, cursor: undefined }, { limit: 200, cursor: 'c2' }]);
});
it('getProfile never asks for labels and maps fields', async () => {
  const get = vi.fn().mockResolvedValue({ profile: { is_custom_image: false, fields: { Xf1: { value: 'Tech', alt: '' } } } });
  const dir = new WebSlackDirectory({ users: { profile: { get } } } as unknown as WebClient);
  expect(await dir.getProfile('U1')).toEqual({ hasCustomImage: false, customFields: { Xf1: 'Tech' } });
  expect(get).toHaveBeenCalledWith({ user: 'U1' });
});
it('getProfile with null fields → {}', async () => { /* fields: null → customFields {} */ });
it('mapFieldDef', () => expect(mapFieldDef({ id: 'Xf1', label: 'Department', type: 'options_list', possible_values: ['Eng'],
  is_hidden: false, options: { is_scim: true, is_protected: false } })).toEqual({ id: 'Xf1', label: 'Department',
  type: 'options_list', possibleValues: ['Eng'], isHidden: false, isScim: true }));
it('mapFieldDef tolerates null possible_values and string options', () => { /* → possibleValues [], isScim false */ });
it('openDm uses conversations.open', async () => { /* conversations.open resolves {channel:{id:'D1'}} → 'D1'; called with {users:'U1'} */ });
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/slack`. Expected: FAIL.

- [ ] **Step 3: Implement `src/slack/types.ts`, `src/slack/web-directory.ts` and `tests/support/fake-directory.ts`**
  - **`authTest`:** maps `auth.test().team`.
  - **`getUser`:** uses `users.info({ user })` and then `mapUser`.
  - **`listCustomFields`:** uses `team.profile.get()` and maps `profile.fields`.
  - **`postMessage` / `updateMessage`:** call `chat.postMessage` / `chat.update` with `{ channel, text, blocks }`.

- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/slack`. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: SlackDirectory seam with Web API implementation and test fake"
```

---

### Task 5: Scope

**Files:**
- Create: `src/scope/scope.ts`
- Test: `tests/scope/scope.test.ts`

**Interfaces:**
- Consumes: `SlackUser` (Task 4).
- Produces:
  - `type ResolvedScope = { only: Set<string> | undefined; exclude: Set<string> }`
  - `type UserIndex = { byId: Map<string, SlackUser>; byEmail: Map<string, SlackUser> }`
  - `indexUsers(users: SlackUser[]): UserIndex`
  - `resolveRefs(refs: string[] | undefined, index: UserIndex): { ids: Set<string> | undefined; unknown: string[]; deactivated: string[] }`
    - `undefined` refs give `undefined` ids.
    - An ID-shaped ref (`^[UW][A-Z0-9]+$`) is always included and is also listed in `unknown` when it isn't in the index.
    - An email (case-insensitive) is included only when it matches someone.
    - A ref that matches a `deleted` user is listed in `deactivated`.
  - `isBaselineEligible(u: SlackUser): boolean`
  - `inGlobalScope(u: SlackUser, includeGuests: boolean, scope: ResolvedScope): boolean`
  - `inScope(userId: string, scope: ResolvedScope): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ['deleted', { deleted: true }], ['bot', { isBot: true }], ['Slackbot', { id: 'USLACKBOT' }],
  ['invited', { isInvitedUser: true }], ['Slack Connect', { isStranger: true }],
])('baseline skips %s', (_, o) => expect(isBaselineEligible(makeUser({ id: 'U1', ...o }))).toBe(false));
it('baseline keeps a normal member', () => expect(isBaselineEligible(makeUser({ id: 'U1' }))).toBe(true));
it('guests only when included', () => {
  const g = makeUser({ id: 'U1', isRestricted: true }), sg = makeUser({ id: 'U2', isUltraRestricted: true });
  const all = { only: undefined, exclude: new Set<string>() };
  expect([inGlobalScope(g, false, all), inGlobalScope(sg, false, all)]).toEqual([false, false]);
  expect([inGlobalScope(g, true, all), inGlobalScope(sg, true, all)]).toEqual([true, true]);
});
it('only then exclude; exclude wins', () => {
  const s = { only: new Set(['U1', 'U2']), exclude: new Set(['U2']) };
  expect(['U1', 'U2', 'U3'].map((id) => inScope(id, s))).toEqual([true, false, false]);
});
it('resolveRefs: emails case-insensitively, IDs always, unknowns and deactivated reported', () => {
  const idx = indexUsers([makeUser({ id: 'U1', email: 'ceo@example.com' }), makeUser({ id: 'U2', deleted: true })]);
  expect(resolveRefs(['CEO@Example.com', 'U999', 'nobody@x.com', 'U2'], idx)).toEqual({
    ids: new Set(['U1', 'U999', 'U2']), unknown: ['U999', 'nobody@x.com'], deactivated: ['U2'] });
  expect(resolveRefs(undefined, idx).ids).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/scope`. Expected: FAIL.
- [ ] **Step 3: Implement `src/scope/scope.ts`** to match the interfaces above.
- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/scope`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: baseline, global and per-rule scope with ID/email refs"
```

---

### Task 6: Rule preparation and evaluation

**Files:**
- Create: `src/rules/prepare.ts`, `src/rules/evaluate.ts`
- Test: `tests/rules/prepare.test.ts`, `tests/rules/evaluate.test.ts`

**Interfaces:**
- Consumes: `RuleConfig`, `ConfigError` (Task 2); `ResolvedCheck`, `runCheck`, `FieldValue` (Task 3); `CustomFieldDef`, `UserProfile` (Task 4).
- Produces:
  - `type RuleTarget = { kind: 'builtin'; field: BuiltinField } | { kind: 'custom'; fieldId: string; label: string }`
  - `type PreparedRule = { id: string; hint: string; target: RuleTarget; check: ResolvedCheck; onlyUsers: string[] | undefined; excludeUsers: string[] | undefined }`
  - `prepareRules(rules: RuleConfig[], fields: CustomFieldDef[]): { rules: PreparedRule[]; warnings: string[] }` (throws `ConfigError`)
  - `type RuleFailure = { ruleId: string; hint: string }`
  - `fieldValue(profile: UserProfile, target: RuleTarget): FieldValue`
  - `needsProfileFetch(rules: PreparedRule[], profile: UserProfile): boolean`
  - `evaluateRules(profile: UserProfile, rules: PreparedRule[]): RuleFailure[]` (in rule order)

- [ ] **Step 1: Write the failing tests**

```ts
const dept = { id: 'Xf1', label: 'Department', type: 'text', possibleValues: [], isHidden: false, isScim: false };
const rule = (o: object) => ({ id: 'department', custom_field: 'Department', check: 'one_of', values: ['Engineering', 'Tech'],
  case_sensitive: false, hint: 'Set your Department to one of: {values}.', ...o }) as RuleConfig;
it('resolves label case-insensitively and expands {values}', () => {
  const { rules } = prepareRules([rule({ custom_field: ' department ' })], [dept]);
  expect(rules[0]).toMatchObject({ target: { kind: 'custom', fieldId: 'Xf1', label: 'Department' },
    hint: 'Set your Department to one of: Engineering, Tech.' });
});
const problemsOf = (f: () => unknown) => { try { f(); } catch (e) { return (e as ConfigError).problems; } throw new Error('did not throw'); };
it('unknown label lists available labels', () => expect(problemsOf(() => prepareRules([rule({ custom_field: 'Dept' })], [dept])))
  .toEqual(['rules[0].custom_field: no custom profile field labelled "Dept". Available: Department']));
it('no custom fields at all → paid-plan message', () => expect(problemsOf(() => prepareRules([rule({})], [])))
  .toEqual(['rules[0].custom_field: this workspace has no custom profile fields (they need a paid Slack plan)']));
it('text field one_of without values is an error', () => expect(problemsOf(() => prepareRules([rule({ values: undefined })], [dept])))
  .toEqual(['rules[0].values: required unless "Department" is a dropdown (options list) field']));
it('options_list without values uses possible_values', () => {
  const f = { ...dept, type: 'options_list', possibleValues: ['Eng', 'Ops'] };
  expect(prepareRules([rule({ values: undefined })], [f]).rules[0]!.check).toEqual({ check: 'one_of', values: ['Eng', 'Ops'], case_sensitive: false });
});
it('warnings: SCIM, hidden, value not an option', () => {
  const f = { ...dept, type: 'options_list', possibleValues: ['Engineering'], isScim: true, isHidden: true };
  expect(prepareRules([rule({})], [f]).warnings).toEqual([
    `rule "department": "Department" is synced from your identity provider (SCIM); people usually can't edit it in Slack`,
    'rule "department": "Department" is hidden in Slack profiles',
    'rule "department": "Tech" is not one of the field\'s options (Engineering)' ]);
});
// evaluate.test.ts
it('fieldValue maps built-ins and custom fields', () => { /* photo→hasCustomImage, phone→phone, display_name→displayName, custom→customFields[id] */ });
it('needsProfileFetch: custom rule → true; photo rule with hasCustomImage undefined → true; built-ins otherwise → false', () => { /* three cases */ });
it('evaluateRules returns failures in rule order with hints', () => { /* photo false + phone '' → [{ruleId:'photo',...},{ruleId:'phone',...}] */ });
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/rules`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement `prepareRules` and `evaluate.ts`.**
  - Gather all problems before throwing a single `ConfigError`.
  - `{values}` expands to `values.join(', ')` for `one_of` only.
- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/rules`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: resolve custom fields by label and evaluate rules"
```

---

### Task 7: State store

**Files:**
- Create: `src/state/store.ts`
- Test: `tests/state/store.test.ts`

**Interfaces:**
- Produces:
  - `type PersonState = { userId: string; lastRemindedAt: number | null; reminderCount: number; dmChannelId: string | null; lastMessageTs: string | null; lastFailures: string[]; updatedAt: number }` (times in epoch ms)
  - `interface StateStore` with these methods:
    - `get(userId: string): PersonState | undefined`
    - `recordReminder(userId: string, r: { at: Date; dmChannelId: string; messageTs: string; failures: string[] }): void`
    - `markCompliant(userId: string, at: Date): void`
    - `close(): void`
  - `openStateStore(path: string): StateStore` (`':memory:'` allowed; creates the parent directory and the table)
  - `isDue(state: PersonState | undefined, now: Date, everyMs: number): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
const t0 = new Date('2026-11-12T08:00:00Z'), DAY = 86_400_000;
it('fresh store has no row', () => expect(openStateStore(':memory:').get('U1')).toBeUndefined());
it('recordReminder increments and keeps latest', () => {
  const s = openStateStore(':memory:');
  s.recordReminder('U1', { at: t0, dmChannelId: 'D1', messageTs: '1.0', failures: ['photo', 'phone'] });
  s.recordReminder('U1', { at: new Date(t0.getTime() + 7 * DAY), dmChannelId: 'D1', messageTs: '2.0', failures: ['phone'] });
  expect(s.get('U1')).toMatchObject({ reminderCount: 2, lastRemindedAt: t0.getTime() + 7 * DAY, lastMessageTs: '2.0', lastFailures: ['phone'] });
});
it('markCompliant resets count, failures and lastRemindedAt but keeps the DM channel', () => { /* → count 0, failures [], lastRemindedAt null, dmChannelId 'D1' */ });
it('markCompliant on an unknown user creates the row', () => { /* get('U9') defined, count 0 */ });
it('persists across reopen in a new directory', () => { /* path = join(mkdtempSync(tmpdir()), 'nested', 'state.db'); record, close, reopen → same row */ });
it.each([[undefined, true], [{ lastRemindedAt: null }, true], [{ lastRemindedAt: t0.getTime() - 7 * DAY + 60_000 }, false],
         [{ lastRemindedAt: t0.getTime() - 7 * DAY }, true]])('isDue %#', (st, due) =>
  expect(isDue(st as PersonState | undefined, t0, 7 * DAY)).toBe(due));
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/state`. Expected: FAIL.
- [ ] **Step 3: Implement with `better-sqlite3`.** Use one table `people`, with `last_failures` stored as JSON text.
- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/state`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: SQLite reminder state"
```

---

### Task 8: Message builders

**Files:**
- Create: `src/messages/reminder.ts`, `src/messages/report.ts`
- Test: `tests/messages/reminder.test.ts`, `tests/messages/report.test.ts`

**Interfaces:**
- Consumes: `MessagesConfig`, `DEFAULT_MESSAGES` (Task 2); `RuleFailure` (Task 6); `SlackMessage` (Task 4).
- Produces:
  - `CHECK_AGAIN_ACTION_ID = 'check_again'`
  - `renderTemplate(tpl: string, vars: Record<string, string>): string` (unknown `{keys}` are left as they are)
  - `escapeText(s: string): string` (`&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`)
  - `buildReminder(a: { firstName: string; failures: RuleFailure[]; messages: MessagesConfig; every: string }): SlackMessage`
  - `buildStillMissing(a: same as buildReminder): SlackMessage`
  - `buildAllDone(messages: MessagesConfig): SlackMessage`
  - `type ComplianceSummary = { inScope: number; complete: number; incomplete: { userId: string; failures: string[] }[]; perRule: { ruleId: string; count: number }[] }`
  - `buildAdminReport(s: ComplianceSummary, opts: { dryRun: boolean; maxListed?: number }): SlackMessage` (`maxListed` defaults to 50)
  - `formatCheckReport(s: ComplianceSummary, names: Map<string, string>): string`

- [ ] **Step 1: Write the failing tests**

```ts
const failures = [{ ruleId: 'photo', hint: 'Upload a photo.' }, { ruleId: 'phone', hint: 'Add your mobile.' }];
it('reminder blocks', () => {
  const m = buildReminder({ firstName: 'Sara', failures, messages: DEFAULT_MESSAGES, every: '7 days' });
  expect(m.text).toBe('Hi Sara! A few things are missing from your Slack profile:');
  expect(m.blocks).toEqual([
    { type: 'section', text: { type: 'mrkdwn', text: 'Hi Sara! A few things are missing from your Slack profile:' } },
    { type: 'section', text: { type: 'mrkdwn', text: '• Upload a photo.\n• Add your mobile.' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: "I'll remind you every 7 days until it's done." }] },
    { type: 'actions', elements: [{ type: 'button', action_id: 'check_again', style: 'primary', text: { type: 'plain_text', text: 'Check again' } }] },
  ]);
});
it('escapes the first name', () => expect(buildReminder({ firstName: '<b>&', failures, messages: DEFAULT_MESSAGES, every: 'week' }).text)
  .toBe('Hi &lt;b&gt;&amp;! A few things are missing from your Slack profile:'));
it('still-missing adds "Checked just now" before the footer', () => {
  const ctx = buildStillMissing({ firstName: 'Sara', failures, messages: DEFAULT_MESSAGES, every: '7 days' }).blocks[2];
  expect(ctx).toEqual({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Checked just now' },
    { type: 'mrkdwn', text: "I'll remind you every 7 days until it's done." }] });
});
it('all done has no button', () => expect(buildAllDone(DEFAULT_MESSAGES)).toEqual({ text: '✅ All set. Thanks for completing your profile!',
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '✅ All set. Thanks for completing your profile!' } }] }));
// report.test.ts
const s = { inScope: 12, complete: 9, incomplete: [{ userId: 'U1', failures: ['photo', 'phone'] }], perRule: [{ ruleId: 'photo', count: 1 }, { ruleId: 'phone', count: 1 }] };
it('admin report text', () => {
  const t = JSON.stringify(buildAdminReport(s, { dryRun: true }).blocks);
  for (const part of ['*Profile check:* 9 of 12 complete, 1 incomplete', '_dry run — nobody was messaged_', '• photo: 1', '<@U1> — photo, phone']) expect(t).toContain(part);
});
it('truncates the list', () => { /* 55 incomplete, maxListed 50 → contains '…and 5 more' and exactly 50 '<@' mentions */ });
it('nobody incomplete', () => { /* incomplete [] → contains "Everyone's profile is complete 🎉", no dry-run label when dryRun false */ });
it('check report for stdout', () => expect(formatCheckReport(s, new Map([['U1', 'Sara Ali']]))).toBe(
  '12 people in scope: 9 complete, 1 incomplete\nBy rule: photo 1, phone 1\nIncomplete:\n  Sara Ali (U1) — photo, phone'));
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/messages`. Expected: FAIL.
- [ ] **Step 3: Implement both modules.**
  - Admin report blocks: a summary section (headline, with the dry-run label on its own line when `dryRun` is on), a per-rule section, then the incomplete-list section.
- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/messages`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: reminder, check-again and admin report messages"
```

---

### Task 9: Check pass

**Files:**
- Create: `src/log.ts`, `src/app/deps.ts`, `src/app/assess.ts`, `src/app/pass.ts`
- Create: `tests/support/spy-logger.ts`
- Test: `tests/app/pass.test.ts`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces:
  - `type Logger = { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void }`
  - `createLogger(level: string): Logger` (pino)
  - `type AppDeps = { dir: SlackDirectory; store: StateStore; config: Config; rules: PreparedRule[]; log: Logger; now: () => Date }`
  - `type Population = { index: UserIndex; global: ResolvedScope; ruleScopes: Map<string, ResolvedScope>; inScope: SlackUser[] }`
  - `buildPopulation(users: SlackUser[], config: Config, rules: PreparedRule[]): Population`
  - `applicableRules(userId: string, rules: PreparedRule[], ruleScopes: Map<string, ResolvedScope>): PreparedRule[]`
  - `assessUser(user: SlackUser, applicable: PreparedRule[], dir: SlackDirectory): Promise<RuleFailure[]>`
  - `type PassResult = { inScope: number; due: number; checked: number; incomplete: number; reminded: number; compliant: number; errors: number }`
  - `runCheckPass(deps: AppDeps): Promise<PassResult>`
  - `spyLogger(): Logger & { lines: { level: string; o: object; msg?: string }[] }` (tests)

**Pass algorithm (spec §7.5)** — for each `user` in `population.inScope`:
1. If no rules apply → skip.
2. If not `isDue(store.get(id), now, parseDuration(every))` → skip.
3. If `working_hours` is set and the user is outside it in `tz` → skip.
   - `tz` is the user's own if `isValidTimeZone(user.tz)`; otherwise `schedule.timezone`.
4. Otherwise the user is due (`due++`). Inside a try block:
   - `failures = assessUser(...)`; `checked++`.
   - **Failures found:** `incomplete++`. Unless `dry_run` is on:
     1. The channel is `state.dmChannelId ?? dir.openDm(id)`.
     2. Post `buildReminder` with `every: describeDuration(...)`.
     3. `store.recordReminder`.
     4. `reminded++`.
   - **No failures:** `store.markCompliant`; `compliant++`.
   - **On error:** `errors++`, then `log.warn({ userId, err: message })`.
5. After the loop: `log.info(result, 'check pass finished')`.

- [ ] **Step 1: Write the failing tests.** Use `FakeSlackDirectory`, `openStateStore(':memory:')`, `spyLogger()` and a mutable `now`.
  - The base config comes from `parseConfigText` with a photo rule, a phone rule and `dry_run: false`.
  - `prepareRules` runs against the fake's fields.

```ts
it('DMs a person missing a photo once, then not again until the gap passes', async () => {
  fake.users = [makeUser({ id: 'U1', profile: { hasCustomImage: false } })];
  await runCheckPass(deps); now = plus(now, HOUR); await runCheckPass(deps);
  expect(fake.posted).toHaveLength(1); expect(fake.posted[0]!.channel).toBe('DU1');
  now = plus(now, 7 * DAY); await runCheckPass(deps);
  expect(fake.posted).toHaveLength(2); expect(fake.openDmCalls).toEqual(['U1']);   // channel cached
});
it('dry_run sends nothing and records nothing', async () => { /* posted [], openDmCalls [], store.get('U1') undefined, result.incomplete 1 */ });
it('marks compliant people', async () => { /* compliant user → result.compliant 1, store.get → reminderCount 0 */ });
it('skips people outside their own working hours', async () => { /* working_hours Mon–Fri 09–17, tz Asia/Dubai, now Sat → due 0, posted [] */ });
it.each([undefined, 'Not/AZone'])('falls back to schedule.timezone when tz is %s (Review Focus 1)', async (tz) => {
  /* schedule.timezone UTC, now Thu 10:00Z, working hours 09–17 → reminded 1 */ });
it('fetches profiles only for due people who need them', async () => {
  /* built-in rules only → getProfileCalls []; add custom_field rule + U1 reminded yesterday, U2 never → getProfileCalls ['U2'] */ });
it('photo rule fetches the profile when users.list omitted is_custom_image', async () => { /* hasCustomImage undefined → getProfileCalls ['U1'] */ });
it("a rule's only_users never re-includes someone excluded globally", async () => {
  /* scope.exclude_users [U1]; rule only_users [U1] → posted [], getProfileCalls [] */ });
it('skips bots, deactivated, invited, Slack Connect people and guests by default', async () => { /* five such users → inScope 0 */ });
it('people with no applicable rules are neither fetched nor messaged', async () => { /* every rule only_users [U2]; U1 → nothing */ });
it("one person's API error doesn't stop the pass", async () => {
  /* custom rule; failProfileFor U1; U1, U2 failing → errors 1, posted to DU2 only; warn line has userId U1 and no field values */ });
it('logs a summary without field values', async () => { /* last info line msg 'check pass finished'; JSON of all lines lacks '+971' */ });
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/app/pass.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `log.ts`, `deps.ts`, `assess.ts` and `pass.ts`.**
  - `assessUser` merges `getProfile()` into `user.profile` only when `needsProfileFetch` says so.
  - It awaits users one at a time (no concurrency).
- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/app/pass.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: scheduled check pass with cooldown, working hours and dry run"
```

---

### Task 10: "Check again" handler

**Files:**
- Create: `src/app/check-again.ts`
- Test: `tests/app/check-again.test.ts`

**Interfaces:**
- Consumes: `AppDeps`, `buildPopulation`, `applicableRules`, `assessUser` (Task 9); message builders (Task 8).
- Produces:
  - `type CheckAgainOutcome = 'all_done' | 'still_missing' | 'debounced'`
  - `createCheckAgainHandler(deps: AppDeps, debounceMs?: number): (a: { userId: string; channel: string; ts: string }) => Promise<CheckAgainOutcome>` (`debounceMs` defaults to 10 000)

**Behaviour:**
1. **Debounce** per user, using `deps.now()`.
2. **Look the person up:** `dir.getUser`, then `buildPopulation([user], config, rules)`.
3. **Not in scope, or no rules apply** → treat as no failures.
4. **No failures:**
   - `updateMessage(channel, ts, buildAllDone)`
   - `store.markCompliant`
   - return `'all_done'`
5. **Failures remain:**
   - `updateMessage(channel, ts, buildStillMissing(...))`
   - return `'still_missing'`
   - The reminder state is not touched.

- [ ] **Step 1: Write the failing tests**

```ts
it('still missing → updates the clicked message, reminder timing unchanged', async () => {
  /* store has U1 reminded at t0 count 1; U1 phone '' → 'still_missing'; fake.updated[0] = {channel:'DU1', ts:'1.0'};
     JSON contains 'Checked just now'; store.get('U1') lastRemindedAt t0, reminderCount 1 */ });
it('fixed → all done and compliant', async () => { /* → 'all_done'; updated text '✅ All set. Thanks for completing your profile!'; reminderCount 0 */ });
it('debounces clicks within 10 s', async () => { /* second click +5s → 'debounced', getUser called once; +11s → processed */ });
it('person excluded by a config change → all done, no profile fetch (Review Focus 5)', async () => {
  /* config scope.exclude_users [U1] → 'all_done', getProfileCalls [] */ });
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/app/check-again.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the handler.**
- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/app/check-again.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: Check again button handler"
```

---

### Task 11: Compliance summary and admin report

**Files:**
- Create: `src/app/report.ts`, `src/slack/errors.ts`
- Test: `tests/app/report.test.ts`

**Interfaces:**
- Consumes: Tasks 8 and 9.
- Produces:
  - `slackErrorCode(err: unknown): string | undefined` (reads `err.data.error`)
  - `summarizeCompliance(deps: Omit<AppDeps, 'store'>): Promise<{ summary: ComplianceSummary; names: Map<string, string> }>`
    - Evaluates **everyone** in global scope and ignores reminder state and working hours.
    - People whose assessment throws are logged and left out of the counts.
    - `perRule` lists every rule in config order, including zero counts.
    - `names` is `realName || displayName || id`.
  - `runAdminReport(deps: AppDeps): Promise<void>`
    - Does nothing without `admin_report`.
    - Posts `buildAdminReport(summary, { dryRun })` to the channel.
    - Never throws.
    - On `not_in_channel` or `channel_not_found`, logs `log.error({ channel }, 'invite Profile Check to the admin channel: /invite @Profile Check')`. Other errors are logged as they are.

- [ ] **Step 1: Write the failing tests**

```ts
it('summarizes everyone regardless of reminder state or working hours', async () => {
  /* U1 complete, U2 photo missing, U3 photo+phone missing; Sunday; U3 reminded yesterday →
     summary {inScope:3, complete:1, incomplete:[{U2:['photo']},{U3:['photo','phone']}], perRule:[{photo,2},{phone,1}]} */ });
it('posts to the admin channel with the dry-run label', async () => { /* admin_report C0ADMIN, dry_run true → posted[0].channel 'C0ADMIN', JSON contains 'dry run — nobody was messaged' */ });
it('no admin_report → posts nothing', async () => { /* posted [] */ });
it('not invited to the channel → logs an invite hint and resolves (Review Focus 4)', async () => {
  fake.postError = { data: { error: 'not_in_channel' } };
  await expect(runAdminReport(deps)).resolves.toBeUndefined();
  expect(log.lines.some((l) => l.level === 'error' && l.msg?.includes('/invite @Profile Check'))).toBe(true);
});
it('a failing assessment is logged and excluded', async () => { /* failProfileFor U2 with custom rule → inScope counts exclude U2; warn line has userId U2 */ });
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/app/report.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `report.ts` and `errors.ts`.**
- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/app/report.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: compliance summary and admin report"
```

---

### Task 12: Bootstrap, CLI, scheduler wiring and health check

**Files:**
- Create: `src/env.ts`, `src/app/bootstrap.ts`, `src/app/start.ts`, `src/health.ts`, `src/cli.ts`, `src/bin.ts`
- Test: `tests/env.test.ts`, `tests/app/bootstrap.test.ts`, `tests/health.test.ts`, `tests/cli.test.ts`

**Interfaces:**
- Consumes: everything above; `App` from `@slack/bolt`; `WebClient` from `@slack/web-api`; `Cron` from `croner`.
- Produces:
  - `type Env = { botToken: string; appToken: string | undefined; configPath: string; dataDir: string; logLevel: string; healthPort: number | undefined }`
  - `readEnv(vars: NodeJS.ProcessEnv, opts: { requireAppToken: boolean }): Env` (throws `Error`)
  - `type Bootstrapped = { config: Config; rules: PreparedRule[]; teamName: string; warnings: string[] }`
  - `bootstrap(configPath: string, dir: SlackDirectory): Promise<Bootstrapped>`. It does spec §7.3 steps 1–4, in order:
    1. `loadConfig`
    2. `authTest` (a failure throws `Error('Slack rejected SLACK_BOT_TOKEN: <code>')`)
    3. `listCustomFields` + `prepareRules`
    4. `listUsers` + ref warnings
  - `startHealthServer(port: number, status: () => object): http.Server`
  - `startApp(env: Env, log: Logger): Promise<{ stop(): Promise<void> }>`
  - `main(argv: string[], vars: NodeJS.ProcessEnv, io: { out(s: string): void; err(s: string): void }, makeDir?: (token: string) => SlackDirectory): Promise<number>`

**Ref warnings** — one per unknown or deactivated ref, for each list, including per-rule lists:
- `scope.exclude_users: "x@y.com" matches nobody in this workspace`
- `rules[1].only_users: "U2" is a deactivated account`

**`startApp` wiring (spec §7.1 / §7.3 step 5):**
1. `new App({ token, appToken, socketMode: true })`, then `WebSlackDirectory(app.client)` and `bootstrap`.
2. Log each warning with `log.warn`.
3. `openStateStore(join(dataDir, 'state.db'))`.
4. `app.action(CHECK_AGAIN_ACTION_ID, …)`: `ack()` first, then call the handler with `body.user.id`, `body.channel.id` and `body.message.ts`. Catch and log errors.
5. `await app.start()`.
6. Create the jobs:
   - `new Cron(schedule.check, { timezone, protect: true, catch }, () => runCheckPass(deps))`, storing the last `PassResult`.
   - The same for `admin_report.schedule` → `runAdminReport`.
7. Log each job's `nextRun()`.
8. If `healthPort` is set, start the health server with status `{ ok: true, lastPass }`.
9. `stop()` stops the jobs, then calls `app.stop()`, closes the server and closes the store.

**`main` commands:**

| Command | Steps | Exit code |
|---|---|---|
| `validate` | `readEnv` (no app token needed) → `bootstrap` → `out('Config OK for workspace "<team>"')`, then `out('warning: …')` for each warning | 0 |
| `check` | `bootstrap` → `summarizeCompliance` → `out(formatCheckReport(...))` | 0 |
| `start` (default) | `startApp`; resolves after SIGINT/SIGTERM has called `stop()` | 0 |

Errors in any command:
- A `ConfigError` → `err('error: <problem>')` for each problem, exit 1.
- Any other error → `err('error: <message>')`, exit 1.
- An unknown command → `err` with the usage text, exit 2.

`bin.ts`: `process.exitCode = await main(process.argv.slice(2), process.env, { out: console.log, err: console.error })`.

- [ ] **Step 1: Write the failing tests**

```ts
// env.test.ts
it('requires the bot token', () => expect(() => readEnv({}, { requireAppToken: false })).toThrow('SLACK_BOT_TOKEN is not set (it starts with xoxb-)'));
it('checks the prefix', () => expect(() => readEnv({ SLACK_BOT_TOKEN: 'abc' }, { requireAppToken: false })).toThrow('SLACK_BOT_TOKEN should start with xoxb-'));
it('requires the app token for start', () => expect(() => readEnv({ SLACK_BOT_TOKEN: 'xoxb-1' }, { requireAppToken: true })).toThrow('SLACK_APP_TOKEN is not set (it starts with xapp-)'));
it('defaults', () => expect(readEnv({ SLACK_BOT_TOKEN: 'xoxb-1' }, { requireAppToken: false })).toEqual(
  { botToken: 'xoxb-1', appToken: undefined, configPath: './config.yaml', dataDir: './data', logLevel: 'info', healthPort: undefined }));
it('rejects a non-numeric HEALTH_PORT', () => expect(() => readEnv({ SLACK_BOT_TOKEN: 'xoxb-1', HEALTH_PORT: 'x' }, { requireAppToken: false })).toThrow('HEALTH_PORT must be a port number'));
// bootstrap.test.ts (config written to a temp file)
it('returns team name, prepared rules and ref warnings', async () => {
  /* scope.exclude_users ['x@y.com'], rule only_users ['U2'] where U2 deleted →
     warnings ['scope.exclude_users: "x@y.com" matches nobody in this workspace', 'rules[0].only_users: "U2" is a deactivated account'] */ });
it('bad token', async () => { /* fake.authTest rejects {data:{error:'invalid_auth'}} → rejects 'Slack rejected SLACK_BOT_TOKEN: invalid_auth' */ });
// health.test.ts
it('serves /healthz', async () => { /* port 0 → GET /healthz 200 JSON {ok:true}; GET /x 404; close */ });
// cli.test.ts
it('validate prints OK and warnings', async () => { /* exit 0; out lines ['Config OK for workspace "Acme"', 'warning: …'] */ });
it('validate with a bad config prints each problem', async () => { /* exit 1; err lines start with 'error: rules[0]' */ });
it('check prints the report', async () => { /* exit 0; out contains 'people in scope' */ });
it('missing token', async () => { /* exit 1; err 'error: SLACK_BOT_TOKEN is not set (it starts with xoxb-)' */ });
it('unknown command', async () => { /* exit 2 */ });
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/env.test.ts tests/app/bootstrap.test.ts tests/health.test.ts tests/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the six modules.** Use `node:util` `parseArgs` for argv and `node:http` for health.
- [ ] **Step 4: Run all tests, the typecheck, lint and build.**
  - Run `npm test && npm run typecheck && npm run lint && npm run build`. Expected: all pass, and `dist/bin.js` exists.
  - Then `node dist/bin.js nope; echo $?` prints the usage text and `2`.
- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: CLI (start, check, validate), bootstrap, scheduler and health check"
```

---

### Task 13: Packaging, manifest and docs

**Files:**
- Create: `manifest.yaml`, `config.example.yaml`, `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`, `LICENSE`
- Test: `tests/packaging.test.ts`

**Interfaces:**
- Consumes: `parseConfigText` (Task 2).

**Contents:**
- **`manifest.yaml`:**
  - `display_information.name: Profile Check`, with a description
  - `features.app_home`: `messages_tab_enabled: true`, `messages_tab_read_only_enabled: true`, `home_tab_enabled: false`
  - `features.bot_user.display_name: Profile Check`
  - `oauth_config.scopes.bot`: exactly the five scopes from Global Constraints
  - `settings`: `interactivity.is_enabled: true`, `socket_mode_enabled: true`, `org_deploy_enabled: false`
- **`config.example.yaml`:** the spec §7.2 example, with `dry_run: true` and a commented `# only_users:` pilot line.
- **`Dockerfile`:**
  - Build stage: `node:24-slim`, `npm ci`, `npm run build`, `npm prune --omit=dev`.
  - Runtime stage: `node:24-slim`, copy `node_modules`, `dist` and `package.json`.
  - `ENV NODE_ENV=production DATA_DIR=/data CONFIG_PATH=/config/config.yaml`.
  - Create `/data` owned by `node`, then `USER node`, `VOLUME /data`.
  - `ENTRYPOINT ["node","dist/bin.js"]`, `CMD ["start"]`.
- **`docker-compose.example.yml`:** one service using `ghcr.io/OWNER/slack-police:latest`:
  - `restart: unless-stopped`
  - mounts `./config.yaml:/config/config.yaml:ro` and a named volume on `/data`
  - `env_file: .env`
- **`ci.yml`:** on push and pull request, Node 24, `npm ci`, then lint, typecheck, test and build.
- **`release.yml`:**
  - Runs on `v*` tags, with `packages: write`.
  - Uses QEMU and Buildx to build `linux/amd64,linux/arm64`.
  - Pushes `ghcr.io/${{ github.repository }}:${{ github.ref_name }}` and `:latest`.
  - Use the current major versions of the official actions.
- **`README.md`:**
  - What it does.
  - The five setup steps from spec §8.
  - A config reference covering every key, check and default from Task 2.
  - The FAQ from spec §8. Also note that dropdown (`options_list`) fields haven't yet been tested against a live workspace (spec §10.2).
- **`LICENSE`:** MIT, `Copyright (c) 2026 slack-police contributors`.

- [ ] **Step 1: Write the failing tests**

```ts
it('example config parses, is dry-run, and shows pilot mode', () => {
  const text = readFileSync('config.example.yaml', 'utf8');
  expect(parseConfigText(text).dry_run).toBe(true);
  expect(text).toContain('# only_users:');
});
it('manifest has exactly the documented scopes and Socket Mode', () => {
  const m = parse(readFileSync('manifest.yaml', 'utf8'));
  expect([...m.oauth_config.scopes.bot].sort()).toEqual(['chat:write', 'im:write', 'users.profile:read', 'users:read', 'users:read.email']);
  expect(m.settings.socket_mode_enabled).toBe(true);
  expect(m.features.app_home.messages_tab_read_only_enabled).toBe(true);
  expect(m.features.bot_user.display_name).toBe('Profile Check');
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/packaging.test.ts`. Expected: FAIL (files are missing).
- [ ] **Step 3: Create the files listed above.**
- [ ] **Step 4: Verify.**
  - Run `npx vitest run tests/packaging.test.ts`. Expected: PASS.
  - If Docker is available, run `docker build -t slack-police . && docker run --rm slack-police nope; echo $?`. Expected: the usage text, then `2`.
- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "chore: Slack manifest, example config, Docker image, CI and README"
```

---

### Task 14: Live acceptance in the author's workspace (needs the author)

Nothing here is product code. These steps need the author's Slack tokens, set in their own shell or in `.env`. Tokens are never pasted into chat. This covers spec §9 manual acceptance and §10 risks 1 and 3.

- [ ] **Step 1: The author creates the app.**
  1. api.slack.com/apps → Create app → From a manifest → paste `manifest.yaml`.
  2. Install it to the workspace.
  3. Create an app-level token with `connections:write`.
  4. Put `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.env`.
- [ ] **Step 2: Write `config.yaml`** from the example:
  - `dry_run: true`
  - `scope.only_users: [<author's email>]`
  - The Department rule: `custom_field: "Department"`, `check: one_of`, with the author's real department list in `values`.
  - Ask the author whether the phone rule should set `mobile_only: true`.
- [ ] **Step 3: Validate.** Run `npm run build && set -a && . ./.env && set +a && node dist/bin.js validate`.
  - Expected: `Config OK for workspace "…"`.
  - There should be no SCIM warning on Department. If there is one, stop and tell the author: people can't edit that field in Slack.
- [ ] **Step 4: Risk 1 — does `users.list` include `is_custom_image`?**
  ```bash
  node --input-type=module -e "import {WebClient} from '@slack/web-api'; const r = await new WebClient(process.env.SLACK_BOT_TOKEN).users.list({limit:200}); const m = r.members.filter(u => !u.is_bot && !u.deleted); console.log(m.length, m.filter(u => u.profile && 'is_custom_image' in u.profile).length)"
  ```
  - This prints two counts and no profile values.
  - Equal counts mean the photo rule never needs the fallback call.
  - Record the result in the README FAQ.
- [ ] **Step 5: Read-only report.** Run `node dist/bin.js check`.
  - Expected: it lists the author with any gaps.
  - To see a failure, the author temporarily blanks their phone.
- [ ] **Step 6: Pilot.**
  1. Set `dry_run: false` and `schedule.check: "*/5 * * * *"`.
  2. Run `node dist/bin.js start`.
  3. Within 5 minutes the DM should arrive in **the Profile Check app's Messages tab** (risk 3), with the bullets, the footer and a "Check again" button.
  4. The author fixes their phone and clicks "Check again". Expected: the message changes to "✅ All set. Thanks for completing your profile!".
- [ ] **Step 7: Admin report.**
  1. Set `admin_report` to a test channel ID with `schedule: "*/5 * * * *"`, without inviting the bot. Expected: the error log shows the `/invite @Profile Check` hint.
  2. Invite the bot. Expected: the next run posts the summary.
- [ ] **Step 8: Docker smoke test.**
  ```bash
  docker run --rm --env-file .env -v "$PWD/config.yaml:/config/config.yaml:ro" -v slack-police-data:/data slack-police validate
  ```
  Expected: the same OK line as Step 3.
- [ ] **Step 9: Hand back.** Restore `schedule.check` and leave the rollout decision to the author: removing `only_users` is the switch that turns it on for everyone. Commit the README FAQ update:
  ```bash
  git commit -am "docs: record live findings"
  ```
