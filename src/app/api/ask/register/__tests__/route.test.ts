/**
 * Unit tests for /api/ask/register schema validation
 *
 * Tests the Zod schema used for validating registration requests.
 * Full integration testing would require a test database.
 */

import { z } from 'zod';

// Recreate the schema here for testing (DRY: matches the one in route.ts)
const emailOnlySchema = z.object({
  askKey: z.string().trim().min(1),
  email: z.string().trim().email().max(255),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
});

describe('/api/ask/register schema validation', () => {
  describe('required fields', () => {
    it('should accept valid email and askKey', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.askKey).toBe('my-ask-key');
        expect(result.data.email).toBe('user@example.com');
      }
    });

    it('should reject missing askKey', () => {
      const result = emailOnlySchema.safeParse({
        email: 'user@example.com',
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty askKey', () => {
      const result = emailOnlySchema.safeParse({
        askKey: '',
        email: 'user@example.com',
      });

      expect(result.success).toBe(false);
    });

    it('should reject whitespace-only askKey', () => {
      const result = emailOnlySchema.safeParse({
        askKey: '   ',
        email: 'user@example.com',
      });

      expect(result.success).toBe(false);
    });

    it('should reject missing email', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
      });

      expect(result.success).toBe(false);
    });

    it('should reject invalid email format', () => {
      const invalidEmails = [
        'not-an-email',
        '@example.com',
        'user@',
        'user@.com',
        '',
      ];

      invalidEmails.forEach(email => {
        const result = emailOnlySchema.safeParse({
          askKey: 'my-ask-key',
          email,
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe('optional fields', () => {
    it('should accept complete registration with all fields', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        firstName: 'Jean',
        lastName: 'Dupont',
        description: 'Responsable marketing',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.firstName).toBe('Jean');
        expect(result.data.lastName).toBe('Dupont');
        expect(result.data.description).toBe('Responsable marketing');
      }
    });

    it('should accept partial profile completion (firstName only)', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        firstName: 'Jean',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.firstName).toBe('Jean');
        expect(result.data.lastName).toBeUndefined();
      }
    });

    it('should accept partial profile completion (lastName only)', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        lastName: 'Dupont',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('field length limits', () => {
    it('should reject firstName over 100 characters', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        firstName: 'A'.repeat(101),
      });

      expect(result.success).toBe(false);
    });

    it('should accept firstName at exactly 100 characters', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        firstName: 'A'.repeat(100),
      });

      expect(result.success).toBe(true);
    });

    it('should reject lastName over 100 characters', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        lastName: 'A'.repeat(101),
      });

      expect(result.success).toBe(false);
    });

    it('should reject description over 2000 characters', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        description: 'A'.repeat(2001),
      });

      expect(result.success).toBe(false);
    });

    it('should accept description at exactly 2000 characters', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        description: 'A'.repeat(2000),
      });

      expect(result.success).toBe(true);
    });

    it('should reject email over 255 characters', () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: longEmail,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('trimming behavior', () => {
    it('should trim whitespace from askKey', () => {
      const result = emailOnlySchema.safeParse({
        askKey: '  my-ask-key  ',
        email: 'user@example.com',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.askKey).toBe('my-ask-key');
      }
    });

    it('should trim whitespace from email', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: '  user@example.com  ',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('user@example.com');
      }
    });

    it('should trim whitespace from firstName', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        firstName: '  Jean  ',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.firstName).toBe('Jean');
      }
    });

    it('should trim whitespace from lastName', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        lastName: '  Dupont  ',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lastName).toBe('Dupont');
      }
    });

    it('should trim whitespace from description', () => {
      const result = emailOnlySchema.safeParse({
        askKey: 'my-ask-key',
        email: 'user@example.com',
        description: '  Some description  ',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe('Some description');
      }
    });
  });
});
