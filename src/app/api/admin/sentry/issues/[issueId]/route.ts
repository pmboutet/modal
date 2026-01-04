import { NextRequest, NextResponse } from "next/server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

interface SentryEvent {
  eventID: string;
  title: string;
  message: string;
  dateCreated: string;
  context: Record<string, unknown>;
  entries: Array<{
    type: string;
    data: unknown;
  }>;
  tags: Array<{
    key: string;
    value: string;
  }>;
}

interface SentryIssueDetail {
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
  metadata: Record<string, unknown>;
  latestEvent?: SentryEvent;
}

/**
 * GET /api/admin/sentry/issues/[issueId]
 * Fetches details for a specific Sentry issue including latest event
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const { issueId } = await params;
    const authToken = process.env.SENTRY_AUTH_TOKEN;

    if (!authToken) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "SENTRY_AUTH_TOKEN not configured"
      }, { status: 500 });
    }

    // Fetch issue details
    const issueUrl = `https://sentry.io/api/0/issues/${issueId}/`;
    const issueResponse = await fetch(issueUrl, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!issueResponse.ok) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: `Sentry API error: ${issueResponse.status}`
      }, { status: issueResponse.status });
    }

    const issue: SentryIssueDetail = await issueResponse.json();

    // Fetch latest event for this issue
    const eventsUrl = `https://sentry.io/api/0/issues/${issueId}/events/latest/`;
    const eventsResponse = await fetch(eventsUrl, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (eventsResponse.ok) {
      issue.latestEvent = await eventsResponse.json();
    }

    return NextResponse.json<ApiResponse<SentryIssueDetail>>({
      success: true,
      data: issue
    });

  } catch (error) {
    console.error('Error fetching Sentry issue:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch Sentry issue'
    }, { status: 500 });
  }
}
