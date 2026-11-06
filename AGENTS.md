# AGENTS.md - Orderly Trading MCP

TypeScript MCP server that wraps the `orderly` CLI. The CLI is the only thing
that touches keys, signs requests, or talks to the Orderly API. This server is a
schema-driven adapter: discover commands, validate arguments, spawn the CLI.

## Commands

```sh
npm run typecheck     # tsc --noEmit (src + tests)
npm test              # builds dist/ then runs vitest (59 tests)
npm run build
node dist/index.js doctor
node dist/index.js tools
node dist/index.js schema
```

`ORDERLY_BIN=/path/to/orderly` overrides CLI discovery. The legacy Node CLI
(v1.0.0) and v2.0.0 do not have `orderly schema`; the minimum is v2.0.1, and
v2.1.1 is recommended (Predict, `faucet-account`, `longAbout`/`numArgs`, the
market short-form fix and DEX auth).

## Architecture

```
src/
├── index.ts              # bin: server (stdio), doctor, tools, schema
├── server.ts             # MCP Server: tools, call dispatch, resources
├── context.ts            # discovery + config + flattened commands
├── config.ts             # env parsing, profiles, limits
├── policy.ts             # fail-closed mutation/read allowlists, secret blocklist
├── args.ts               # pure `buildArgv` + validation + enum overrides
├── output.ts             # CLI stdout/stderr -> MCP tool result
├── network.ts            # CLI config defaultNetwork + MCP override
├── resources.ts          # orderly://schema|accounts|config|guide
├── doctor.ts             # discovery/config/account diagnostics
├── cli/
│   ├── locate.ts         # candidate discovery + schema validation
│   ├── schema.ts         # manifest parsing/flattening/name normalization
│   ├── process.ts        # shell-free spawn, timeout, bounded output
│   └── run.ts            # runOrderly wrapper
└── tools/
    ├── generate.ts       # SchemaCommand -> MCP Tool (JSON Schema + annotations)
    ├── metadata.ts       # curated descriptions for core tools
    ├── manual.ts         # orderly_commands, orderly_run, leverage_get
    └── status.ts         # orderly_status when the CLI is missing
```

Data flow: `orderly schema` at startup → flatten commands → policy filter →
`buildTools` → MCP `ListTools`. Calls go `buildArgv` → `spawn` → parse stdout →
`ToolResult`.

## Invariants (do not break)

1. **No key management.** `SECRET_COMMANDS` in `policy.ts` is absolute. Never add
   the mutating `wallet-*` commands, `auth-import`, `auth-logout`,
   `auth-cleanup`, `broker-create`, or `auth-export-key`. The last one is
   `mutates:false` in the manifest but prints a private key; it is denied by name
   on purpose. Read-only `wallet-list` / `wallet-show` are allowed.
2. **Mutations are allowlisted, not denylisted.** A new mutating CLI command must
   be reviewed and added to `TRADING_MUTATIONS` (or `FULL_ONLY_MUTATIONS`).
   Unknown mutating commands fail closed.
3. **Reads are allowlisted too.** Add reviewed read commands to `READ_COMMANDS`.
   Unknown reads stay hidden unless `ORDERLY_MCP_ALLOW_UNKNOWN_READS=1`.
4. **Never use a shell.** Spawn with an argv array (`spawn`, not `exec`). Account
   IDs and order IDs must never be shell-interpolated.
5. **argv order matters.** `[command, ...flags, '--', ...positionals]`. Flags use
   `--name=value`. Do not put flags before the subcommand.
6. **stdin is closed.** Interactive CLI prompts must fail fast, not hang.
7. **stdout is the MCP protocol channel.** Never `console.log` in server mode.
   Debug output goes to `process.stderr` behind `ORDERLY_MCP_DEBUG`.
8. **`--network` is always passed** with the resolved value. Resolution order:
   per-call `network` → `ORDERLY_MCP_NETWORK` → `~/.orderly-cli/config.json`
   `defaultNetwork` → testnet. `orderly_run` accepts a top-level `network`; do
   not drop it.
9. **Mutations are serialized** through a queue; do not run two at once.

## CLI quirks encoded here

- `order-place.quantity` is optional in the manifest but required by the CLI in
  both forms → `REQUIRED_OVERRIDES`.
- `leverage` is read-only when `value` is omitted and mutating when present →
  split into `leverage_get` (manual read tool) and `leverage_set` (generated).
- `order-place.side` accepts `BID`/`ASK` short forms the manifest does not list.
  They are translated to `side=BUY/SELL, type=MARKET`; never send `order_type` of
  `BID`/`ASK` (the API would create a resting limit order).
- `order-place` requires `type` for BUY/SELL; only BID/ASK may omit it.
- `batch-order-cancel` takes variadic positionals (`numArgs.max > 1`).
- `batch-order-place.orders` accepts a JSON string, path, array or object. A
  single object is wrapped in an array before spawning.
- Commands without a `dry-run` arg must reject `dry_run` with a clear message.
- `auth-list` prints text (not JSON) with exit 0 when no keys are stored.

## Extending

To add a core tool:

1. Add the command path to `CORE_COMMANDS` in `policy.ts`.
2. Add its path to `READ_COMMANDS` if it is read-only.
3. Add a description to `TOOL_METADATA` in `tools/metadata.ts`.
4. Add the command to `test/fixtures/schema.json` and a policy/args test.
5. Update the tool count in `README.md` and the core table.

To add a read-only escape-hatch command, add it to `READ_COMMANDS`; otherwise it
stays hidden.

To support a new CLI release: run `orderly schema`, check `longAbout`/`numArgs`
are present, and bump `MIN_CLI_VERSION` in `cli/locate.ts` only if required.

## Releasing

- Bump `package.json`, `package-lock.json` and all versions in `server.json`
  together; the release workflow checks the tag against `package.json` and the
  registry workflow rejects manifest mismatches.
- Tag `vX.Y.Z` and push. `ci.yaml` runs on pushes/PRs, `release.yaml` verifies
  (typecheck/test/build/pack) and publishes npm with provenance, and
  `publish-registry.yaml` validates `server.json`, waits for npm, then runs
  `mcp-publisher publish` with GitHub OIDC.
- Requires the `NPM_TOKEN` repository secret. No Docker image: stdio only.

## CLI dependency

CLI **v2.1.1** is released (80 commands: Predict, `faucet-account`, the
`longAbout`/`numArgs` schema fields, the market short-form fix, trading-error
classification and DEX auth). The MCP requires v2.0.1 minimum and falls back
cleanly on it: no Predict tools, no `faucet-account`, shorter descriptions, and
the hardcoded variadic fallback. `MIN_CLI_VERSION` is in `cli/locate.ts`.

The local CLI HEAD is the tagged v2.1.1 release commit.

## Tests

- `test/args.test.ts` — argv construction, enums, variadics, required overrides,
  numeric validation and the BID/ASK market translation.
- `test/policy.test.ts` — secret blocks, fail-closed read/mutation allowlists,
  profiles, read-only.
- `test/config.test.ts` — default account and policy switches.
- `test/output.test.ts` — truncation, partial batch failures and error hints.
- `test/run.test.ts` — spawn, exit codes, timeout, truncation.
- `test/mutex.test.ts` — mutation serialization.
- `test/protocol.test.ts` — real stdio MCP client against the fake CLI.

The fake CLI (`test/fixtures/fake-orderly.mjs`) serves `schema`, echoes argv, and
simulates failures/timeouts via `FAKE_MODE`. `pretest` runs `npm run build` so the
protocol tests exercise `dist/index.js`.
