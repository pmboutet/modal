import { NextRequest, NextResponse } from "next/server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: string;
  status: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
  };
}

interface SentryIssuesResponse {
  issues: SentryIssue[];
  total: number;
}

/**
 * GET /api/admin/sentry/issues
 * Fetches issues from Sentry API
 *
 * Query params:
 * - limit: number of issues to fetch (default: 25)
 * - query: Sentry search query (e.g., "is:unresolved", "level:error")
 * - statsPeriod: time period (e.g., "24h", "14d")
 */
export async function GET(request: NextRequest) {
  try {
    const authToken = process.env.SENTRY_AUTH_TOKEN;
    const org = process.env.SENTRY_ORG;
    const project = process.env.SENTRY_PROJECT;

    if (!authToken) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "SENTRY_AUTH_TOKEN not configured"
      }, { status: 500 });
    }

    if (!org || !project) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "SENTRY_ORG or SENTRY_PROJECT not configured"
      }, { status: 500 });
    }

    const url = new URL(request.url);
    const limit = url.searchParams.get('limit') || '25';
    const query = url.searchParams.get('query') || 'is:unresolved';
    const statsPeriod = url.searchParams.get('statsPeriod') || '14d';

    const sentryUrl = `https://sentry.io/api/0/projects/${org}/${project}/issues/?limit=${limit}&query=${encodeURIComponent(query)}&statsPeriod=${statsPeriod}`;

    const response = await fetch(sentryUrl, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Sentry API error:', response.status, errorText);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: `Sentry API error: ${response.status}`
      }, { status: response.status });
    }

    const issues: SentryIssue[] = await response.json();

    return NextResponse.json<ApiResponse<SentryIssuesResponse>>({
      success: true,
      data: {
        issues,
        total: issues.length,
      }
    });

  } catch (error) {
    console.error('Error fetching Sentry issues:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch Sentry issues'
    }, { status: 500 });
  }
}
