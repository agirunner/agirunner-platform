import {
  readInspectorView,
  type InspectorView,
} from '../../components/execution-inspector/execution-inspector-support.js';

export function readLogsSurfaceView(searchParams: URLSearchParams): InspectorView {
  return readInspectorView(searchParams);
}
