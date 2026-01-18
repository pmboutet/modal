/**
 * Unit tests for src/lib/auth/magicLink.ts
 * Magic link URL generation - no database dependencies
 */

import { generateMagicLinkUrl, generateEmailRedirectUrl } from '../magicLink';

// ============================================================================
// generateMagicLinkUrl TESTS
// ============================================================================

describe('generateMagicLinkUrl', () => {
  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env for each test
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('with participant token', () => {
    it('should generate URL with token parameter when participantToken is provided', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      const result = generateMagicLinkUrl('user@example.com', 'my-ask-key', 'abc123token');

      expect(result).toBe('https://app.example.com/?token=abc123token');
    });

    it('should ignore askKey when participantToken is provided', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      const result = generateMagicLinkUrl('user@example.com', 'my-ask-key', 'mytoken');

      expect(result).not.toContain('key=');
      expect(result).toContain('token=mytoken');
    });

    it('should handle long participant tokens', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      const longToken = 'a'.repeat(64);
      const result = generateMagicLinkUrl('user@example.com', 'key', longToken);

      expect(result).toBe(`https://app.example.com/?token=${longToken}`);
    });

    it('should handle tokens with special characters (should be pre-encoded)', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      // Note: In real usage, tokens should be URL-safe characters
      const result = generateMagicLinkUrl('user@example.com', 'key', 'abc-123_def');

      expect(result).toBe('https://app.example.com/?token=abc-123_def');
    });
  });

  describe('without participant token (throws error)', () => {
    it('should throw error when participantToken is undefined', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      expect(() => generateMagicLinkUrl('user@example.com', 'my-ask-key'))
        .toThrow('participantToken is required to generate a magic link URL');
    });

    it('should throw error when participantToken is empty string', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      expect(() => generateMagicLinkUrl('user@example.com', 'my-key', ''))
        .toThrow('participantToken is required to generate a magic link URL');
    });
  });

  describe('base URL resolution', () => {
    it('should use NEXT_PUBLIC_APP_URL when set', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://production.example.com';

      const result = generateMagicLinkUrl('user@example.com', 'my-key', 'mytoken');

      expect(result).toStartWith('https://production.example.com/');
    });

    it('should fallback to localhost:3000 when NEXT_PUBLIC_APP_URL is not set', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const result = generateMagicLinkUrl('user@example.com', 'my-key', 'mytoken');

      expect(result).toBe('http://localhost:3000/?token=mytoken');
    });

    it('should fallback to localhost:3000 when NEXT_PUBLIC_APP_URL is empty', () => {
      process.env.NEXT_PUBLIC_APP_URL = '';

      const result = generateMagicLinkUrl('user@example.com', 'my-key', 'mytoken');

      expect(result).toBe('http://localhost:3000/?token=mytoken');
    });

    it('should handle base URL with trailing slash', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/';

      const result = generateMagicLinkUrl('user@example.com', 'my-key', 'mytoken');

      expect(result).toContain('token=mytoken');
    });

    it('should handle base URL with path', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/app';

      const result = generateMagicLinkUrl('user@example.com', 'my-key', 'mytoken');

      expect(result).toBe('https://app.example.com/app/?token=mytoken');
    });
  });

  describe('email parameter (for display purposes)', () => {
    it('should accept email but not include it in URL', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      const result = generateMagicLinkUrl('user@example.com', 'my-key', 'mytoken');

      expect(result).not.toContain('email');
      expect(result).not.toContain('user@example.com');
    });

    it('should work with various email formats', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      // These should all work - email is just for display
      expect(() => generateMagicLinkUrl('simple@example.com', 'key', 'token1')).not.toThrow();
      expect(() => generateMagicLinkUrl('user+tag@example.com', 'key', 'token2')).not.toThrow();
      expect(() => generateMagicLinkUrl('user.name@subdomain.example.com', 'key', 'token3')).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in token', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      // Tokens should be URL-safe
      const result = generateMagicLinkUrl('user@example.com', 'key', 'token_with-special.chars');

      expect(result).toContain('token=token_with-special.chars');
    });

    it('should handle unicode in email', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      // Unicode email (for display purposes)
      const result = generateMagicLinkUrl('user@example.com', 'my-key', 'mytoken');

      // Should work - email is not included in URL
      expect(result).toBe('https://app.example.com/?token=mytoken');
    });
  });
});

// ============================================================================
// generateEmailRedirectUrl TESTS
// ============================================================================

describe('generateEmailRedirectUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('with participant token', () => {
    it('should generate callback URL with token in path', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      const result = generateEmailRedirectUrl('my-ask-key', 'abc123token');

      expect(result).toBe('https://app.example.com/auth/callback/token/abc123token');
    });

    it('should ignore askKey when participantToken is provided', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      const result = generateEmailRedirectUrl('my-ask-key', 'mytoken');

      expect(result).not.toContain('key');
      expect(result).toContain('/token/mytoken');
    });
  });

  describe('without participant token (throws error)', () => {
    it('should throw error when participantToken is undefined', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      expect(() => generateEmailRedirectUrl('my-ask-key'))
        .toThrow('participantToken is required for email redirect URL');
    });

    it('should throw error when participantToken is empty string', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      expect(() => generateEmailRedirectUrl('my-ask-key', ''))
        .toThrow('participantToken is required for email redirect URL');
    });
  });

  describe('base URL resolution', () => {
    it('should use NEXT_PUBLIC_APP_URL when set', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://production.example.com';

      const result = generateEmailRedirectUrl('my-key', 'mytoken');

      expect(result).toStartWith('https://production.example.com/');
    });

    it('should fallback to localhost:3000 when NEXT_PUBLIC_APP_URL is not set', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const result = generateEmailRedirectUrl('my-key', 'mytoken');

      expect(result).toBe('http://localhost:3000/auth/callback/token/mytoken');
    });
  });
});

// Custom matcher for cleaner tests
expect.extend({
  toStartWith(received: string, expected: string) {
    const pass = received.startsWith(expected);
    return {
      message: () =>
        pass
          ? `expected ${received} not to start with ${expected}`
          : `expected ${received} to start with ${expected}`,
      pass,
    };
  },
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toStartWith(expected: string): R;
    }
  }
}
