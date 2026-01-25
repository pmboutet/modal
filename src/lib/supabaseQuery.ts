import * as Sentry from "@sentry/nextjs";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase query result type - works with both Promise and thenable builders
 */
type QueryResult<T> = { data: T | null; error: PostgrestError | null };
type QueryOperation<T> = PromiseLike<QueryResult<T>> | Promise<QueryResult<T>>;

/**
 * Context for a database query - used for logging and error tracking
 */
export interface QueryContext {
  /** Table name being queried */
  table: string;
  /** Type of operation */
  operation: "select" | "insert" | "update" | "delete" | "rpc";
  /** Whether we expect data to be returned (alerts if empty) */
  expectData?: boolean;
  /** Key filters applied (for debugging context) */
  filters?: Record<string, unknown>;
  /** Optional description for better error messages */
  description?: string;
}

/**
 * Custom error class for database errors with rich context
 */
export class DatabaseError extends Error {
  public readonly code: string | undefined;
  public readonly context: QueryContext;
  public readonly originalError: PostgrestError;

  constructor(error: PostgrestError, context: QueryContext) {
    const message = `[DB ${context.operation.toUpperCase()}] ${context.table}: ${error.message}`;
    super(message);
    this.name = "DatabaseError";
    this.code = error.code;
    this.context = context;
    this.originalError = error;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DatabaseError);
    }
  }
}

/**
 * Result type for safe queries
 */
export type SafeQueryResult<T> =
  | { data: T; error: null; isEmpty: boolean }
  | { data: null; error: DatabaseError; isEmpty: true };

/**
 * Executes a Supabase query with automatic error tracking and Sentry integration.
 *
 * Features:
 * - Automatically reports errors to Sentry with full context
 * - Warns when expected data is empty (possible RLS issue)
 * - Provides consistent error handling across the app
 * - Tracks query performance
 *
 * @example
 * // Basic usage - throws on error
 * const users = await safeQuery(
 *   () => supabase.from('profiles').select('*').eq('is_active', true),
 *   { table: 'profiles', operation: 'select' }
 * );
 *
 * @example
 * // With expected data check (warns if empty)
 * const user = await safeQuery(
 *   () => supabase.from('profiles').select('*').eq('id', userId).single(),
 *   { table: 'profiles', operation: 'select', expectData: true, filters: { id: userId } }
 * );
 *
 * @example
 * // Non-throwing version for custom error handling
 * const result = await safeQueryNoThrow(
 *   () => supabase.from('profiles').select('*'),
 *   { table: 'profiles', operation: 'select' }
 * );
 * if (result.error) {
 *   // Handle error...
 * }
 */
export async function safeQuery<T>(
  operation: () => QueryOperation<T>,
  context: QueryContext
): Promise<T> {
  const result = await safeQueryNoThrow<T>(operation, context);

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

/**
 * Same as safeQuery but returns a result object instead of throwing.
 * Use this when you want to handle errors yourself.
 */
export async function safeQueryNoThrow<T>(
  operation: () => QueryOperation<T>,
  context: QueryContext
): Promise<SafeQueryResult<T>> {
  const startTime = performance.now();
  const transactionName = `db.${context.operation}.${context.table}`;

  // Start a Sentry span for performance tracking
  return Sentry.startSpan(
    {
      name: transactionName,
      op: "db.query",
      attributes: {
        "db.table": context.table,
        "db.operation": context.operation,
        "db.filters": context.filters ? JSON.stringify(context.filters) : undefined,
      },
    },
    async (span) => {
      try {
        const { data, error } = await operation();
        const duration = performance.now() - startTime;

        // Log slow queries (> 1 second)
        if (duration > 1000) {
          console.warn(`[DB SLOW] ${transactionName} took ${duration.toFixed(0)}ms`, context);
          Sentry.addBreadcrumb({
            category: "db.slow",
            message: `Slow query: ${transactionName}`,
            level: "warning",
            data: { duration, ...context },
          });
        }

        // Handle explicit error
        if (error) {
          const dbError = new DatabaseError(error, context);

          // Report to Sentry with full context
          Sentry.captureException(dbError, {
            tags: {
              db_table: context.table,
              db_operation: context.operation,
              db_error_code: error.code,
            },
            extra: {
              filters: context.filters,
              description: context.description,
              errorDetails: error.details,
              errorHint: error.hint,
              duration,
            },
            level: "error",
          });

          console.error(`[DB ERROR] ${transactionName}:`, {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
            filters: context.filters,
            duration,
          });

          span?.setStatus({ code: 2, message: error.message }); // Error status

          return { data: null, error: dbError, isEmpty: true };
        }

        // Check for unexpected empty results
        const isEmpty = data === null || (Array.isArray(data) && data.length === 0);

        if (context.expectData && isEmpty) {
          const warningMessage = `[DB WARNING] ${transactionName}: expected data but got empty result`;

          console.warn(warningMessage, {
            filters: context.filters,
            description: context.description,
            duration,
          });

          // Report to Sentry as a warning (possible RLS issue or missing data)
          Sentry.captureMessage(warningMessage, {
            level: "warning",
            tags: {
              db_table: context.table,
              db_operation: context.operation,
              issue_type: "unexpected_empty_result",
            },
            extra: {
              filters: context.filters,
              description: context.description,
              possibleCauses: [
                "RLS policy blocking access",
                "Data does not exist",
                "Wrong filter values",
                "Missing joins/relationships",
              ],
              duration,
            },
          });

          Sentry.addBreadcrumb({
            category: "db.empty",
            message: `Unexpected empty result: ${transactionName}`,
            level: "warning",
            data: { filters: context.filters, duration },
          });
        }

        span?.setStatus({ code: 1, message: "ok" }); // OK status

        return { data: data as T, error: null, isEmpty };
      } catch (unexpectedError) {
        // Catch any unexpected errors (network issues, etc.)
        const errorMessage =
          unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError);

        Sentry.captureException(unexpectedError, {
          tags: {
            db_table: context.table,
            db_operation: context.operation,
            error_type: "unexpected",
          },
          extra: {
            filters: context.filters,
            description: context.description,
          },
          level: "error",
        });

        console.error(`[DB UNEXPECTED ERROR] ${transactionName}:`, unexpectedError);

        span?.setStatus({ code: 2, message: errorMessage });

        // Convert to DatabaseError for consistency
        // Note: PostgrestError requires 'name' field in some versions
        const postgrestError = {
          name: "PostgrestError",
          message: errorMessage,
          details: "Unexpected error during query execution",
          hint: "Check network connectivity and Supabase service status",
          code: "UNEXPECTED",
        } as PostgrestError;

        return {
          data: null,
          error: new DatabaseError(postgrestError, context),
          isEmpty: true,
        };
      }
    }
  );
}

/**
 * Helper to create a query executor with pre-bound context.
 * Useful when making multiple queries to the same table.
 *
 * @example
 * const profilesQuery = createQueryExecutor(supabase, 'profiles');
 *
 * const allProfiles = await profilesQuery(
 *   client => client.from('profiles').select('*'),
 *   { operation: 'select' }
 * );
 *
 * const singleProfile = await profilesQuery(
 *   client => client.from('profiles').select('*').eq('id', userId).single(),
 *   { operation: 'select', expectData: true, filters: { id: userId } }
 * );
 */
export function createQueryExecutor(supabase: SupabaseClient, table: string) {
  return async <T>(
    queryFn: (client: SupabaseClient) => QueryOperation<T>,
    options: Omit<QueryContext, "table">
  ): Promise<T> => {
    return safeQuery<T>(() => queryFn(supabase), { table, ...options });
  };
}

/**
 * Wraps an RPC call with error tracking
 *
 * @example
 * const result = await safeRpc(
 *   supabase,
 *   'get_user_stats',
 *   { user_id: userId },
 *   { expectData: true }
 * );
 */
export async function safeRpc<T>(
  supabase: SupabaseClient,
  functionName: string,
  params: Record<string, unknown>,
  options: { expectData?: boolean; description?: string } = {}
): Promise<T> {
  return safeQuery<T>(
    // The RPC call returns a thenable that we await
    () => supabase.rpc(functionName, params) as unknown as QueryOperation<T>,
    {
      table: functionName,
      operation: "rpc",
      filters: params,
      ...options,
    }
  );
}

/**
 * Adds a database breadcrumb to Sentry for debugging.
 * Call this before important queries to provide context in error reports.
 */
export function addDbBreadcrumb(
  message: string,
  data?: Record<string, unknown>
): void {
  Sentry.addBreadcrumb({
    category: "db",
    message,
    level: "info",
    data,
  });
}

/**
 * Sets the current user context in Sentry.
 * Call this after authentication to associate errors with users.
 */
export function setUserContext(user: {
  id: string;
  email?: string;
  role?: string;
}): void {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    role: user.role,
  });
}

/**
 * Clears the user context (call on logout)
 */
export function clearUserContext(): void {
  Sentry.setUser(null);
}

/**
 * Captures a database/RLS error to Sentry with context.
 * Use this when you handle errors manually instead of using safeQuery.
 *
 * @example
 * const { data, error } = await supabase.from('insights').select('*');
 * if (error) {
 *   captureDbError(error, 'insights', 'select', { askSessionId });
 *   throw error;
 * }
 */
export function captureDbError(
  error: PostgrestError | Error,
  table: string,
  operation: string,
  extra?: Record<string, unknown>
): void {
  const isPostgrestError = 'code' in error && 'details' in error;

  Sentry.captureException(error, {
    tags: {
      db_table: table,
      db_operation: operation,
      db_error_code: isPostgrestError ? (error as PostgrestError).code : undefined,
      error_type: isPostgrestError ? 'postgrest' : 'unexpected',
    },
    extra: {
      ...extra,
      errorDetails: isPostgrestError ? (error as PostgrestError).details : undefined,
      errorHint: isPostgrestError ? (error as PostgrestError).hint : undefined,
    },
    level: 'error',
  });

  console.error(`[DB ERROR] ${operation} ${table}:`, {
    message: error.message,
    code: isPostgrestError ? (error as PostgrestError).code : undefined,
    ...extra,
  });
}
