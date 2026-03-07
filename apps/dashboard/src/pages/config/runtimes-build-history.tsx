import { useQuery } from '@tanstack/react-query';
import { Loader2, Eye, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  dashboardApi,
  type DashboardCustomizationStatusResponse,
  type DashboardCustomizationBuildResponse,
} from '../../lib/api.js';
import { readSession } from '../../lib/session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface BuildHistoryEntry {
  buildId: string;
  status: 'linked' | 'valid' | 'failed';
  image: string | null;
  date: string;
}

function formatDigestAsImage(digest: string | undefined): string | null {
  if (!digest) return null;
  const short = digest.length > 16 ? `${digest.slice(0, 16)}...` : digest;
  return `runtime:${short}`;
}

function statusBadgeVariant(status: string): 'success' | 'secondary' | 'destructive' {
  if (status === 'linked') return 'success';
  if (status === 'valid') return 'secondary';
  return 'destructive';
}

function deriveStatusFromState(
  runtimeStatus: DashboardCustomizationStatusResponse,
): 'linked' | 'valid' | 'failed' {
  if (runtimeStatus.active_digest && runtimeStatus.configured_digest) return 'linked';
  if (runtimeStatus.state === 'ready' || runtimeStatus.state === 'active') return 'valid';
  return 'failed';
}

function buildHistoryFromStatus(
  status: DashboardCustomizationStatusResponse | undefined,
): BuildHistoryEntry[] {
  if (!status?.active_digest && !status?.configured_digest) return [];

  const derivedStatus = status ? deriveStatusFromState(status) : 'valid';
  const digest = status?.active_digest ?? status?.configured_digest;

  return [
    {
      buildId: digest ? `bld-${digest.slice(0, 6)}` : 'bld-current',
      status: derivedStatus,
      image: formatDigestAsImage(digest),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    },
  ];
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function fetchRuntimeStatus(): Promise<DashboardCustomizationStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/runtime/customizations/status`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

export function ActiveRuntimeImageCard(): JSX.Element {
  const { data: status, isLoading, error } = useQuery({
    queryKey: ['runtime-customization-status'],
    queryFn: fetchRuntimeStatus,
  });
  const [manifestVisible, setManifestVisible] = useState(false);
  const [manifest, setManifest] = useState<string | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);

  async function handleViewManifest(): Promise<void> {
    if (manifestVisible) {
      setManifestVisible(false);
      return;
    }
    try {
      setIsLoadingManifest(true);
      const result = await dashboardApi.reconstructCustomization();
      setManifest(JSON.stringify(result.manifest, null, 2));
      setManifestVisible(true);
    } catch {
      setManifest('Failed to load manifest.');
      setManifestVisible(true);
    } finally {
      setIsLoadingManifest(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </CardContent>
      </Card>
    );
  }

  if (error || !status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Runtime Image</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Runtime status unavailable. The runtime customization service may not be configured.
          </p>
        </CardContent>
      </Card>
    );
  }

  const derivedStatus = deriveStatusFromState(status);
  const activeImage = formatDigestAsImage(status.active_digest);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Active Runtime Image</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleViewManifest()} disabled={isLoadingManifest}>
            {isLoadingManifest ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
            View Manifest
          </Button>
          <Button variant="outline" size="sm" disabled>
            <RotateCcw className="h-3 w-3" />
            Rollback
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted block">Image</span>
            <span className="font-mono">{activeImage ?? 'No active image'}</span>
          </div>
          <div>
            <span className="text-muted block">Digest</span>
            <span className="font-mono text-xs">{status.active_digest ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-muted block">Status</span>
            <Badge variant={statusBadgeVariant(derivedStatus)}>{derivedStatus}</Badge>
          </div>
          <div>
            <span className="text-muted block">State</span>
            <span>{status.state}</span>
          </div>
        </div>
        {manifestVisible && manifest ? (
          <pre className="rounded-md bg-border/20 p-3 text-xs font-mono overflow-auto max-h-48">
            {manifest}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function BuildHistoryCard(): JSX.Element {
  const { data: status, isLoading, error } = useQuery({
    queryKey: ['runtime-customization-status'],
    queryFn: fetchRuntimeStatus,
  });

  const entries = buildHistoryFromStatus(status);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Build History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted">
            Unable to load build history. The runtime service may not be reachable.
          </p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted">No builds recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Build ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.buildId}>
                  <TableCell className="font-mono text-xs">{entry.buildId}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(entry.status)}>{entry.status}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.image ?? '\u2014'}
                  </TableCell>
                  <TableCell className="text-xs">{entry.date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
