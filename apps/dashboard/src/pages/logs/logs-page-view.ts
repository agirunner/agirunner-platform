import {
  readInspectorView,
  type InspectorView,
} from '../../components/execution-inspector/execution-inspector-support.js';

export function readLogsSurfaceView(searchParams: URLSearchParams): InspectorView {
  const view = readInspectorView(searchParams);
  if (view === 'raw') {
    return view;
  }
  return searchParams.get('log') ? view : 'raw';
}
