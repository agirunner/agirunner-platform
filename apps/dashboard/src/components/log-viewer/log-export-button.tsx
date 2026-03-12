import { useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { dashboardApi } from '../../lib/api.js';
import { useLogFilters } from './hooks/use-log-filters.js';
import { applyLogScope, type LogScope } from './log-scope.js';

type ExportFormat = 'json' | 'csv';

function buildFileName(format: ExportFormat): string {
  const date = new Date().toISOString().slice(0, 10);
  return `logs-${date}.${format}`;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function LogExportButton({ scope }: { scope?: LogScope }): JSX.Element {
  const { toQueryParams } = useLogFilters();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setIsExporting(true);
      try {
        const params = { ...applyLogScope(toQueryParams(), scope), format };
        const blob = await dashboardApi.exportLogs(params);
        triggerBlobDownload(blob, buildFileName(format));
      } finally {
        setIsExporting(false);
      }
    },
    [scope, toQueryParams],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isExporting}>
          <Download className="h-4 w-4" />
          {isExporting ? 'Exporting…' : 'Export'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handleExport('json')}>Export as JSON</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handleExport('csv')}>Export as CSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
