export interface ToolMetadata {
  title?: string;
  description: string;
  required?: string[];
}

/**
 * Hand-written descriptions for the core tools. Everything else falls back to
 * the CLI's own about/long_about text.
 */
export const TOOL_METADATA: Record<string, ToolMetadata> = {
  'auth-list': {
    title: 'List Orderly accounts',
    description:
      'List stored API-key accounts: account ID, wallet address, network and public key. No secrets are returned. Use an accountId from this list as the `account` argument on other tools. Call this first when the account is unknown.',
  },
  'account-balance': {
    title: 'Account balance',
    description:
      "Show the account's token holdings (USDC balance, frozen amount, isolated margin). Use positions_list for account value, free collateral and margin ratios.",
  },
  'positions-list': {
    title: 'List open positions',
    description:
      'List open positions plus account value, free collateral and margin ratios. Use product_type=BINARY for Orderly Predict positions (positive quantity is UP, negative is DOWN).',
  },
  'order-list': {
    title: 'List orders',
    description:
      'List orders, defaulting to open/incomplete orders. Filter by symbol, status, side, order_type or product_type. Set all=true to include completed orders. Use order_get via orderly_run for one specific order.',
  },
  'market-price': {
    title: 'Market price',
    description:
      'Get index price, mark price, 24h statistics, funding and open interest for one symbol (e.g. PERP_ETH_USDC). Read-only.',
  },
  'market-orderbook': {
    title: 'Market order book',
    description:
      'Get the order book for one symbol, including best bid/ask and depth. Use it to price limit orders. Read-only.',
  },
  kline: {
    title: 'Candlestick data',
    description:
      'Get candlestick/kline data. type is one of 1m, 5m, 15m, 30m, 1h, 4h, 12h, 1d, 1w, 1mon; size defaults to 100 (max 1000). Read-only.',
  },
  'order-place': {
    title: 'Place a perpetual order',
    description:
      'Place a perpetual-futures order. ALWAYS call with dry_run=true first to preview the exact request, then repeat with dry_run=false to execute. symbol must be uppercase (e.g. PERP_ETH_USDC). type is LIMIT, MARKET, IOC, FOK or POST_ONLY and is required for BUY/SELL orders. price is required for LIMIT, IOC, FOK and POST_ONLY. Short form: side=BID (market buy) or ASK (market sell), with no type or price. For Orderly Predict rounds use predict_buy/predict_sell instead. Set client_order_id to make retries idempotent. Returns the order object, including order_id.',
    required: ['symbol', 'side', 'quantity'],
  },
  'order-cancel': {
    title: 'Cancel an order',
    description:
      'Cancel one order by order_id. symbol is optional and auto-fetched when omitted. Call with dry_run=true to preview the DELETE request before executing.',
  },
  'order-cancel-all': {
    title: 'Cancel all orders',
    description:
      'Cancel every open order, optionally limited to one symbol. This is destructive and has no dry-run; prefer order_cancel for a single order unless the user explicitly asks to cancel all.',
  },
  'batch-order-place': {
    title: 'Place a batch of orders',
    description:
      'Place multiple perpetual-futures orders in one call. Returns {"rows":[...]} with a per-order success flag and order_id or error_message. The MCP reports a partial failure as an error; inspect the rows for which orders were accepted.',
  },
  'batch-order-cancel': {
    title: 'Cancel a batch of orders',
    description:
      'Cancel multiple orders by ID in one call. Returns per-order result rows; the MCP reports a partial failure as an error.',
  },
  'algo-order-place': {
    title: 'Place an algo order',
    description:
      'Place a STOP, TP_SL, POSITIONAL_TP_SL, TRAILING_STOP or BRACKET order. Returns {"rows":[{"order_id":...}]}. Use algo_order_list to inspect active algo orders.',
  },
  'broker-status': {
    title: 'Broker status',
    description:
      'Read DEX/broker registration status for an EVM address. Requires CLI v2.1.1 or newer for DEX API authentication.',
  },
  'positions-close': {
    title: 'Close a position',
    description:
      'Close a position with a reduce-only MARKET order. Omit quantity to close the full position; pass quantity for a partial close. Perpetual futures only — use predict_close for Orderly Predict. Preview with dry_run=true.',
  },
  leverage: {
    title: 'Set leverage',
    description:
      'Set leverage for a symbol. value is required. Preview a change with dry_run=true. Use leverage_get to read the current leverage without mutating.',
  },
  'predict-buy': {
    title: 'Buy Predict shares',
    description:
      'Buy UP or DOWN shares in an Orderly Predict round. Read the round symbol from predict_rounds — never construct or reuse one. price is in the selected direction (0.01-0.99); DOWN buys are sent to the UP book as SELL at 1-price. Only LIMIT, IOC and POST_ONLY. Preview with dry_run=true.',
  },
  'predict-sell': {
    title: 'Sell Predict shares',
    description:
      'Sell (reduce) an existing UP or DOWN Orderly Predict position. price is in the selected direction. Always reduce-only. Preview with dry_run=true.',
  },
  'predict-close': {
    title: 'Close a Predict position',
    description:
      'Close a full or partial Orderly Predict position with a protected IOC reduce-only order. Omit shares to close the full position. Preview with dry_run=true.',
  },
};
