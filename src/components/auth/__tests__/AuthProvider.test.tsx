/**
 * Tests for AuthProvider component
 * @jest-environment jsdom
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthProvider';
import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js';

// Mock Supabase client
const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();
const mockSignInWithOAuth = jest.fn();
const mockSignOut = jest.fn();
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// Set environment variables before tests
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe('AuthProvider', () => {
  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    user_metadata: {
      fullName: 'Test User',
    },
    app_metadata: {},
    aud: 'authenticated',
    created_at: '2024-01-01T00:00:00Z',
  } as User;

  const mockSession: Session = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Date.now() / 1000 + 3600,
    token_type: 'bearer',
    user: mockUser,
  };

  const mockProfile = {
    id: 'profile-123',
    auth_id: 'user-123',
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'User',
    full_name: 'Test User',
    role: 'user',
    client_id: null,
    avatar_url: null,
    is_active: true,
    last_login: null,
    job_title: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default mock implementations
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: jest.fn(),
        },
      },
    });

    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: mockProfile,
            error: null,
          }),
        }),
      }),
    });

    mockSignOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should start with loading status', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      // Initially loading (before auth state change fires)
      expect(result.current.status).toBe('loading');
    });
  });

  describe('signIn', () => {
    it('should call signInWithPassword with credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      mockOnAuthStateChange.mockImplementation(() => ({
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Advance timers to complete initialization
      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await act(async () => {
        const response = await result.current.signIn('test@example.com', 'password123');
        expect(response.error).toBeUndefined();
      });

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('should return error on failed sign in', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid credentials' },
      });

      mockOnAuthStateChange.mockImplementation(() => ({
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await act(async () => {
        const response = await result.current.signIn('wrong@example.com', 'wrongpass');
        expect(response.error).toBe('Invalid credentials');
      });
    });
  });

  describe('signUp', () => {
    it('should call signUp with email, password, and metadata', async () => {
      mockSignUp.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      mockOnAuthStateChange.mockImplementation(() => ({
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.signUp('new@example.com', 'password123', {
          fullName: 'New User',
          firstName: 'New',
          lastName: 'User',
        });
      });

      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
        options: {
          data: expect.objectContaining({
            fullName: 'New User',
            firstName: 'New',
            lastName: 'User',
          }),
        },
      });
    });

    it('should return error on failed sign up', async () => {
      mockSignUp.mockResolvedValue({
        data: { session: null },
        error: { message: 'Email already registered' },
      });

      mockOnAuthStateChange.mockImplementation(() => ({
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await act(async () => {
        const response = await result.current.signUp('existing@example.com', 'password');
        expect(response.error).toBe('Email already registered');
      });
    });
  });

  describe('signInWithGoogle', () => {
    it('should call signInWithOAuth with Google provider', async () => {
      mockSignInWithOAuth.mockResolvedValue({ error: null });

      mockOnAuthStateChange.mockImplementation(() => ({
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.signInWithGoogle();
      });

      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: expect.objectContaining({
          redirectTo: expect.stringContaining('/auth/callback'),
          skipBrowserRedirect: false,
        }),
      });
    });
  });

  describe('signOut', () => {
    it('should call Supabase signOut and clear state', async () => {
      mockOnAuthStateChange.mockImplementation((callback) => {
        setTimeout(() => callback('INITIAL_SESSION', mockSession), 0);
        return {
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        };
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.signOut();
      });

      expect(mockSignOut).toHaveBeenCalled();
      expect(result.current.status).toBe('signed-out');
      expect(result.current.user).toBeNull();
    });
  });

  describe('auth state change handling', () => {
    it('should handle SIGNED_IN event', async () => {
      // Mock getSession to return a session
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      mockOnAuthStateChange.mockImplementation(() => ({
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.status).toBe('signed-in');
      });
    });

    it('should handle SIGNED_OUT event', async () => {
      let authCallback: (event: AuthChangeEvent, session: Session | null) => void;

      mockOnAuthStateChange.mockImplementation((callback) => {
        authCallback = callback;
        setTimeout(() => callback('INITIAL_SESSION', mockSession), 0);
        return {
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        };
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await act(async () => {
        authCallback!('SIGNED_OUT', null);
        await Promise.resolve();
      });

      expect(result.current.status).toBe('signed-out');
      expect(result.current.user).toBeNull();
    });

    it('should unsubscribe on unmount', async () => {
      const mockUnsubscribe = jest.fn();

      mockOnAuthStateChange.mockReturnValue({
        data: {
          subscription: {
            unsubscribe: mockUnsubscribe,
          },
        },
      });

      const { unmount } = renderHook(() => useAuth(), { wrapper });

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle profile fetch errors gracefully', async () => {
      // Mock getSession to return a session
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      mockOnAuthStateChange.mockImplementation(() => ({
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      }));

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'Profile not found' },
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.status).toBe('signed-in');
      });

      // User should still be signed in even if profile fetch fails
      expect(result.current.user).toBeTruthy();
    });
  });

  describe('useAuth hook', () => {
    it('should throw error when used outside AuthProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAuth());
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });
});
