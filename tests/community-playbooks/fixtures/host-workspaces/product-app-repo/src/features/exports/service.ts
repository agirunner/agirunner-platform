export function describeExportFailure(code: string): string {
  if (code === 'TIMEOUT') {
    return 'Export exceeded the worker time budget.';
  }

  return 'Export failed.';
}
