import { describe, expect, it } from 'vitest';
import { buildArgv } from '../src/args.js';
import { command } from './helpers.js';

const testnet = { network: 'testnet' as const };

describe('buildArgv', () => {
  it('builds a full limit order with flags before positionals', () => {
    const result = buildArgv(
      command('order-place'),
      {
        symbol: 'PERP_ETH_USDC',
        side: 'buy',
        type: 'limit',
        quantity: 0.01,
        price: 3500,
        client_order_id: 'c-1',
        dry_run: true,
      },
      testnet
    );
    expect(result).toEqual({
      argv: [
        'order-place',
        '--network=testnet',
        '--price=3500',
        '--client-order-id=c-1',
        '--dry-run',
        '--',
        'PERP_ETH_USDC',
        'BUY',
        'LIMIT',
        '0.01',
      ],
    });
  });

  it('translates the BID/ASK short form to an explicit market order', () => {
    const bid = buildArgv(
      command('order-place'),
      { symbol: 'PERP_ETH_USDC', side: 'BID', quantity: 0.01, dry_run: true },
      testnet
    );
    expect(bid).toEqual({
      argv: [
        'order-place',
        '--network=testnet',
        '--dry-run',
        '--',
        'PERP_ETH_USDC',
        'BUY',
        'MARKET',
        '0.01',
      ],
    });

    const ask = buildArgv(
      command('order-place'),
      { symbol: 'PERP_ETH_USDC', side: 'ask', quantity: 0.02 },
      testnet
    );
    expect(ask).toEqual({
      argv: [
        'order-place',
        '--network=testnet',
        '--',
        'PERP_ETH_USDC',
        'SELL',
        'MARKET',
        '0.02',
      ],
    });
  });

  it('requires an explicit type for BUY/SELL orders', () => {
    const result = buildArgv(
      command('order-place'),
      { symbol: 'PERP_ETH_USDC', side: 'BUY', quantity: 0.01 },
      testnet
    );
    expect('error' in result && result.error).toContain(
      'Missing required argument "type"'
    );
  });

  it('rejects type or price with the BID/ASK short form', () => {
    const withType = buildArgv(
      command('order-place'),
      {
        symbol: 'PERP_ETH_USDC',
        side: 'BID',
        type: 'MARKET',
        quantity: 0.01,
      },
      testnet
    );
    expect('error' in withType && withType.error).toContain(
      'must be omitted when side is BID'
    );

    const withPrice = buildArgv(
      command('order-place'),
      {
        symbol: 'PERP_ETH_USDC',
        side: 'ASK',
        quantity: 0.01,
        price: 2100,
      },
      testnet
    );
    expect('error' in withPrice && withPrice.error).toContain(
      'must be omitted when side is ASK'
    );
  });

  it('rejects BID/ASK as an explicit order type', () => {
    const result = buildArgv(
      command('order-place'),
      {
        symbol: 'PERP_ETH_USDC',
        side: 'BUY',
        type: 'BID',
        quantity: 0.01,
      },
      testnet
    );
    expect('error' in result && result.error).toContain(
      'must be LIMIT, MARKET, IOC, FOK or POST_ONLY'
    );
  });

  it('rejects missing and non-positive numeric values before spawning', () => {
    const negative = buildArgv(
      command('order-place'),
      {
        symbol: 'PERP_ETH_USDC',
        side: 'BUY',
        type: 'LIMIT',
        quantity: -1,
        price: 2100,
      },
      testnet
    );
    expect('error' in negative && negative.error).toContain(
      'must be a positive number'
    );

    const zeroPrice = buildArgv(
      command('order-place'),
      {
        symbol: 'PERP_ETH_USDC',
        side: 'BUY',
        type: 'LIMIT',
        quantity: 0.01,
        price: 0,
      },
      testnet
    );
    expect('error' in zeroPrice && zeroPrice.error).toContain(
      'must be a positive number'
    );

    const oversizedKline = buildArgv(
      command('kline'),
      { symbol: 'PERP_ETH_USDC', type: '1m', size: 5000 },
      testnet
    );
    expect('error' in oversizedKline && oversizedKline.error).toContain(
      'must be <= 1000'
    );
  });

  it('requires quantity even though the manifest marks it optional', () => {
    const result = buildArgv(
      command('order-place'),
      { symbol: 'PERP_ETH_USDC', side: 'BUY' },
      testnet
    );
    expect('error' in result && result.error).toContain(
      'Missing required argument "quantity"'
    );
  });

  it('rejects unknown arguments and lists the valid ones', () => {
    const result = buildArgv(
      command('order-place'),
      { symbol: 'PERP_ETH_USDC', side: 'BUY', quantity: 1, nonsense: true },
      testnet
    );
    expect('error' in result && result.error).toContain(
      'Unknown argument "nonsense"'
    );
  });

  it('keeps lowercase interval enums and uppercases symbol enums', () => {
    const kline = buildArgv(
      command('kline'),
      { symbol: 'PERP_ETH_USDC', type: '1h', size: 50 },
      testnet
    );
    expect(kline).toEqual({
      argv: [
        'kline',
        '--network=testnet',
        '--size=50',
        '--',
        'PERP_ETH_USDC',
        '1h',
      ],
    });

    const order = buildArgv(
      command('order-place'),
      { symbol: 'PERP_ETH_USDC', side: 'sell', type: 'market', quantity: 1 },
      testnet
    );
    expect(
      'argv' in order ? order.argv.slice(-4) : []
    ).toEqual(['PERP_ETH_USDC', 'SELL', 'MARKET', '1']);
  });

  it('expands variadic positionals and JSON-stringifies batch orders', () => {
    const cancel = buildArgv(
      command('batch-order-cancel'),
      { order_ids: ['111', '222'], dry_run: true },
      testnet
    );
    expect(cancel).toEqual({
      argv: [
        'batch-order-cancel',
        '--network=testnet',
        '--dry-run',
        '--',
        '111',
        '222',
      ],
    });

    const place = buildArgv(
      command('batch-order-place'),
      { orders: [{ symbol: 'PERP_ETH_USDC' }] },
      testnet
    );
    expect(place).toEqual({
      argv: [
        'batch-order-place',
        '--network=testnet',
        '--',
        '[{"symbol":"PERP_ETH_USDC"}]',
      ],
    });

    const single = buildArgv(
      command('batch-order-place'),
      { orders: { symbol: 'PERP_ETH_USDC' } },
      testnet
    );
    expect(single).toEqual({
      argv: [
        'batch-order-place',
        '--network=testnet',
        '--',
        '[{"symbol":"PERP_ETH_USDC"}]',
      ],
    });
  });

  it('expands variadic positionals when numArgs is absent (CLI 2.0.1 fallback)', () => {
    const result = buildArgv(
      command('batch-order-cancel-by-client-id'),
      { client_order_ids: ['a', 'b'] },
      testnet
    );
    expect(result).toEqual({
      argv: [
        'batch-order-cancel-by-client-id',
        '--network=testnet',
        '--',
        'a',
        'b',
      ],
    });
  });

  it('honours a per-call network override', () => {
    const result = buildArgv(
      command('market-price'),
      { symbol: 'PERP_ETH_USDC', network: 'mainnet' },
      testnet
    );
    expect('argv' in result && result.argv[1]).toBe('--network=mainnet');
  });

  it('rejects dry_run on commands that cannot preview', () => {
    const result = buildArgv(
      command('order-cancel-all'),
      { symbol: 'PERP_ETH_USDC', dry_run: true },
      testnet
    );
    expect('error' in result && result.error).toContain(
      'does not support dry_run'
    );
  });

  it('accepts camelCase and snake_case aliases', () => {
    const result = buildArgv(
      command('order-place'),
      {
        symbol: 'PERP_ETH_USDC',
        side: 'BUY',
        type: 'LIMIT',
        quantity: '1',
        clientOrderId: 'abc',
        reduceOnly: true,
      },
      testnet
    );
    expect(result).toEqual({
      argv: [
        'order-place',
        '--network=testnet',
        '--client-order-id=abc',
        '--reduce-only',
        '--',
        'PERP_ETH_USDC',
        'BUY',
        'LIMIT',
        '1',
      ],
    });
  });
});
