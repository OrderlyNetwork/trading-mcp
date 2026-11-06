import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  commandsForProfile,
  isCommandAllowed,
  visibleCommands,
} from '../src/policy.js';
import type { SchemaCommand } from '../src/types.js';
import { command, fixtureSchema } from './helpers.js';

const core = loadConfig({
  ORDERLY_MCP_PROFILE: 'core',
} as NodeJS.ProcessEnv);

describe('policy', () => {
  it('never exposes secret or key-management commands', () => {
    expect(isCommandAllowed(command('auth-export-key'), core).allowed).toBe(
      false
    );
    expect(isCommandAllowed(command('wallet-import'), core).allowed).toBe(
      false
    );
  });

  it('fails closed for unreviewed read commands', () => {
    const unreviewed: SchemaCommand = {
      path: 'wallet-export-seed',
      about: 'not reviewed',
      longAbout: null,
      mutates: false,
      args: [],
      subcommands: [],
    };
    expect(isCommandAllowed(unreviewed, core).allowed).toBe(false);
    expect(
      isCommandAllowed(unreviewed, {
        ...core,
        allowUnknownReads: true,
      }).allowed
    ).toBe(true);
  });

  it('fails closed for unknown mutating commands', () => {
    const unknown: SchemaCommand = {
      path: 'funds-drain',
      about: 'not reviewed',
      longAbout: null,
      mutates: true,
      args: [],
      subcommands: [],
    };
    expect(isCommandAllowed(unknown, core).allowed).toBe(false);
  });

  it('blocks every mutation in read-only mode', () => {
    const readOnly = { ...core, readOnly: true };
    expect(isCommandAllowed(command('order-place'), readOnly).allowed).toBe(
      false
    );
    expect(isCommandAllowed(command('market-price'), readOnly).allowed).toBe(
      true
    );
    expect(
      commandsForProfile(fixtureSchema.commands, readOnly).map(
        (cmd) => cmd.path
      )
    ).toEqual([
      'auth-list',
      'account-balance',
      'positions-list',
      'order-list',
      'market-price',
      'market-orderbook',
      'kline',
    ]);
  });

  it('keeps core small and puts predict behind its profile', () => {
    const corePaths = commandsForProfile(fixtureSchema.commands, core).map(
      (cmd) => cmd.path
    );
    expect(corePaths).toHaveLength(12);
    expect(corePaths).not.toContain('predict-buy');
    expect(corePaths).not.toContain('order-edit');

    const predict = { ...core, profile: 'predict' as const };
    expect(
      commandsForProfile(fixtureSchema.commands, predict).map(
        (cmd) => cmd.path
      )
    ).toContain('predict-buy');
  });

  it('includes all six Predict commands in the predict profile', () => {
    const paths = [
      'predict-rounds',
      'predict-round',
      'predict-orderbook',
      'predict-buy',
      'predict-sell',
      'predict-close',
    ];
    const seen = new Set(fixtureSchema.commands.map((cmd) => cmd.path));
    const extra: SchemaCommand[] = paths
      .filter((path) => !seen.has(path))
      .map((path) => ({
        path,
        about: path,
        longAbout: null,
        mutates: ['predict-buy', 'predict-sell', 'predict-close'].includes(
          path
        ),
        args: [],
        subcommands: [],
      }));
    const predict = { ...core, profile: 'predict' as const };
    const selected = commandsForProfile(
      [...fixtureSchema.commands, ...extra],
      predict
    ).map((cmd) => cmd.path);
    for (const path of paths) expect(selected).toContain(path);
  });

  it('allows withdraw only in the full profile', () => {
    const all = { ...core, profile: 'all' as const };
    const full = { ...core, profile: 'full' as const };
    expect(isCommandAllowed(command('withdraw'), all).allowed).toBe(false);
    expect(isCommandAllowed(command('withdraw'), full).allowed).toBe(true);
  });

  it('shows every allowed command to the escape hatch', () => {
    const all = { ...core, profile: 'all' as const };
    const paths = visibleCommands(fixtureSchema.commands, all).map(
      (cmd) => cmd.path
    );
    expect(paths).toContain('order-edit');
    expect(paths).toContain('batch-order-cancel');
    expect(paths).not.toContain('wallet-import');
    expect(paths).not.toContain('auth-export-key');
  });
});
