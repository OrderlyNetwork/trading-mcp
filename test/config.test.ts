import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('config', () => {
  it('reads ORDERLY_MCP_ACCOUNT as a trimmed default account', () => {
    const config = loadConfig({
      ORDERLY_MCP_ACCOUNT: '  0xabc  ',
    } as NodeJS.ProcessEnv);
    expect(config.account).toBe('0xabc');
  });

  it('defaults the account to null', () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    expect(config.account).toBeNull();
    expect(config.allowUnknownReads).toBe(false);
    expect(config.strictProfile).toBe(false);
  });

  it('parses read and profile policy switches', () => {
    const config = loadConfig({
      ORDERLY_MCP_ALLOW_UNKNOWN_READS: '1',
      ORDERLY_MCP_STRICT_PROFILE: 'true',
    } as NodeJS.ProcessEnv);
    expect(config.allowUnknownReads).toBe(true);
    expect(config.strictProfile).toBe(true);
  });
});
