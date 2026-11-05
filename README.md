# Orderly Trading MCP

MCP server that gives AI clients trading access to Orderly Network through the
locally installed [`orderly` CLI](https://github.com/OrderlyNetwork/cli).

Private keys live in the OS keychain. The MCP process **never sees them** and
never signs anything — it only discovers the CLI's command surface, validates
arguments, and runs the CLI as a subprocess.

```
MCP client ⇄ stdio ⇄ orderly-trading-mcp ⇄ execFile ⇄ orderly CLI ⇄ Orderly API
                                                     ↳ OS keychain
```

## Requirements

- Node.js >= 20
- `orderly` CLI **v2.0.1+** (v2.1.0+ recommended; it adds richer command
  metadata to `orderly schema`)
- A wallet/API key already set up in the CLI (`orderly auth-list` shows them)

## Install

```sh
# CLI (installs to ~/.local/bin)
curl -fsSL https://orderly.network/cli.sh | sh

# MCP server
npm install -g @orderly.network/trading-mcp
orderly-trading-mcp doctor
```

`doctor` prints every CLI candidate it found, the selected binary, the effective
profile/network, and the accounts visible in the keychain.

## Client configuration

The reliable form sets `ORDERLY_BIN` explicitly. GUI clients often launch with a
minimal `PATH`, so `~/.local/bin` may not be visible even though your terminal
finds `orderly`.

**Claude Code / Cursor** (`.mcp.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "orderly-trading": {
      "command": "npx",
      "args": ["-y", "@orderly.network/trading-mcp"],
      "env": {
        "ORDERLY_BIN": "/Users/you/.local/bin/orderly"
      }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "orderly-trading": {
      "command": "npx",
      "args": ["-y", "@orderly.network/trading-mcp"],
      "env": { "ORDERLY_BIN": "/Users/you/.local/bin/orderly" }
    }
  }
}
```

**OpenCode** (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "orderly-trading": {
      "type": "local",
      "command": ["npx", "-y", "@orderly.network/trading-mcp"],
      "environment": { "ORDERLY_BIN": "/Users/you/.local/bin/orderly" },
      "enabled": true
    }
  }
}
```

**Codex** (`.codex/config.toml`):

```toml
[mcp_servers.orderly-trading]
command = "npx"
args = ["-y", "@orderly.network/trading-mcp"]
env = { ORDERLY_BIN = "/Users/you/.local/bin/orderly" }
```

## Tools

The default `core` profile registers 14 tools:

| Tool | Kind | Purpose |
| --- | --- | --- |
| `auth_list` | read | Stored accounts (public IDs only) |
| `account_balance` | read | Token holdings |
| `positions_list` | read | Positions, account value, margin |
| `order_list` | read | Working orders |
| `market_price` | read | Mark/index/24h stats |
| `market_orderbook` | read | Depth and best bid/ask |
| `kline` | read | Candles |
| `order_place` | write | Place a perpetual order |
| `order_cancel` | write | Cancel one order |
| `order_cancel_all` | write | Cancel all orders |
| `positions_close` | write | Reduce-only market close |
| `leverage` | write | Read or set leverage |
| `orderly_commands` / `orderly_run` | meta | Full CLI coverage |

Everything else — algo/TP-SL orders, batch orders, Predict, trades, funding,
history, symbols, fee tiers — is reached through the escape hatch:

```
orderly_commands({ query: "algo" })
orderly_run({
  command: "algo-order-place",
  args: {
    symbol: "PERP_ETH_USDC", side: "SELL", algo_type: "TP_SL",
    quantity: 0.01, tp_trigger_price: 2500, account: "0x..."
  }
})
```

`orderly_run` applies the same policy as the dedicated tools: secret-command
blocklist, mutation allowlist, read-only mode and mainnet gate. Because it *can*
mutate, it is annotated non-read-only; reads routed through it may trigger an
extra client confirmation. Prefer the dedicated read tools for listings.

Profiles add dedicated tools for domains:

| `ORDERLY_MCP_PROFILE` | Tools |
| --- | --- |
| `core` (default) | 14 |
| `predict` | core + `predict_rounds`, `predict_orderbook`, `predict_buy`, `predict_sell`, `predict_close` |
| `algo` | core + `algo_order_place`, `algo_order_cancel`, `algo_order_list` |
| `all` | every read command + every allowed trading mutation (~66) |
| `full` | `all` + `withdraw`, `faucet_usdc`, `faucet_account` |

## Safety model

| Variable | Default | Effect |
| --- | --- | --- |
| `ORDERLY_BIN` | auto | Explicit CLI path; if set and invalid, no fallback |
| `ORDERLY_MCP_PROFILE` | `core` | Tool surface (see above) |
| `ORDERLY_MCP_READ_ONLY` | off | Set `1` to disable every mutation |
| `ORDERLY_MCP_NETWORK` | CLI config | Default network override |
| `ORDERLY_MCP_ALLOW_MAINNET` | `true` | Set `0` to block mainnet mutations |
| `ORDERLY_MCP_TIMEOUT_MS` | `30000` | Per-call timeout |
| `ORDERLY_MCP_MAX_OUTPUT` | `65536` | Max characters returned per call |
| `ORDERLY_MCP_DEBUG` | off | Log argv/timing to stderr |

`faucet_account --wait` can take up to 120 seconds; raise
`ORDERLY_MCP_TIMEOUT_MS` (for example to `180000`) before using it.

Design rules:

- **Keys never enter the MCP.** `wallet-*`, `auth-import`, `auth-logout`,
  `auth-cleanup`, `broker-create` and `auth-export-key` are blocked in every
  profile, including `orderly_run`. `auth-export-key` is read-only in the CLI
  manifest but prints a private key, so it is denied explicitly.
- **Fail-closed mutations.** Only an explicit allowlist of trading commands can
  mutate. A new mutating CLI command stays invisible until it is reviewed.
- **No shell.** The CLI is spawned with an argv array, so hex account IDs and
  other values cannot inject shell syntax.
- **No hangs.** stdin is closed, so interactive CLI prompts fail fast; every
  call has a timeout.
- **Mutations are serialized**, so parallel tool calls cannot double-submit.
- **Preview first.** Mutating tools that support `--dry-run` expose a `dry_run`
  argument; descriptions instruct the model to preview before executing.
- **No automatic retries** for mutations.

## Output and errors

The CLI's compact JSON is passed through unchanged. Non-JSON output (for example
`No keys stored...`) is returned as text. Errors include the CLI stderr and the
exit-code meaning:

| Code | Meaning |
| --- | --- |
| 2 | Usage/validation — call `orderly_commands` |
| 3 | Authentication — check `auth_list` / set up a key with the CLI |
| 4 | Trading rejection — check balance, leverage, symbol, price |
| 5 | Transient — retry after a delay |

Resources: `orderly://schema`, `orderly://accounts`, `orderly://config`,
`orderly://guide`.

## Development

```sh
npm install
npm run typecheck     # tsc --noEmit
npm test              # builds dist/ + 33 unit/protocol tests
npm run build
npm run doctor
node dist/index.js tools   # print the registered tool list
```

Tests use a hermetic fake CLI (`test/fixtures/fake-orderly.mjs`), so they do not
need network, keychain or the real binary.

The CLI schema is loaded once at server startup. Restart the MCP server after
upgrading the CLI or changing `ORDERLY_MCP_PROFILE` / `ORDERLY_BIN`.

## Releasing

1. Bump `version` in `package.json` and every version in `server.json`, then
   commit. The registry workflow rejects mismatched versions.
2. Tag and push:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. `.github/workflows/release.yaml` runs typecheck, tests and build, then
   publishes to npm with provenance (`NPM_TOKEN` secret required).
4. `.github/workflows/publish-registry.yaml` waits for the npm version to appear,
   then publishes `server.json` to the MCP registry with GitHub OIDC.

There is no Docker image: this server is stdio-only, unlike the read-only MCP.

## Not included (on purpose)

- Key, wallet, auth and broker management tools.
- HTTP transport. Exposing a trading server over the network needs its own
  authentication and threat model; stdio only for now.
- Automatic CLI download. Install it explicitly; the installer verifies the
  release checksum.
