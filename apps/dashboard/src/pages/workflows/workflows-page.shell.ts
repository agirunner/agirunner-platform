import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { NavigateFunction } from 'react-router-dom';

import {
  buildWorkflowsPageHref,
  type WorkflowLaunchRequest,
  type WorkflowsPageState,
} from './workflows-page.support.js';
import { patchPageState } from './workflows-page.controller.js';
import {
  beginWorkflowRailResize,
  beginWorkflowWorkbenchResize,
  clampWorkflowRailWidthPx,
  clampWorkflowWorkbenchFraction,
  DEFAULT_WORKFLOW_RAIL_WIDTH_PX,
  DEFAULT_WORKFLOW_WORKBENCH_FRACTION,
} from './workflows-layout.js';
import {
  readStoredWorkflowRailHidden,
  readStoredWorkflowRailWidth,
  readStoredWorkflowWorkbenchFraction,
  writeStoredWorkflowRailHidden,
  writeStoredWorkflowRailWidth,
  writeStoredWorkflowWorkbenchFraction,
} from './workflows-page.storage.js';

export const ACTIVITY_PAGE_SIZE = 50;
export const DELIVERABLES_PAGE_SIZE = 12;

export function useWorkflowsPageShell(input: {
  launchRequest: WorkflowLaunchRequest;
  navigate: NavigateFunction;
  pageState: WorkflowsPageState;
}) {
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_PAGE_SIZE);
  const [deliverablesLimit, setDeliverablesLimit] = useState(DELIVERABLES_PAGE_SIZE);
  const [isLaunchOpen, setIsLaunchOpen] = useState(false);
  const [launchPlaybookId, setLaunchPlaybookId] = useState<string | null>(null);
  const [launchWorkspaceId, setLaunchWorkspaceId] = useState<string | null>(null);
  const [launchWorkflowName, setLaunchWorkflowName] = useState<string | null>(null);
  const [launchParameterDrafts, setLaunchParameterDrafts] = useState<Record<string, string>>({});
  const [isAddWorkOpen, setIsAddWorkOpen] = useState(false);
  const [addWorkTargetWorkItemId, setAddWorkTargetWorkItemId] = useState<string | null>(null);
  const [repeatSourceWorkItemId, setRepeatSourceWorkItemId] = useState<string | null>(null);
  const [isSteeringOpen, setIsSteeringOpen] = useState(false);
  const [steeringTargetWorkItemId, setSteeringTargetWorkItemId] = useState<string | null>(null);
  const [isRailHidden, setIsRailHidden] = useState(readStoredWorkflowRailHidden());
  const [railWidthPx, setRailWidthPx] = useState(
    clampWorkflowRailWidthPx(readStoredWorkflowRailWidth() ?? DEFAULT_WORKFLOW_RAIL_WIDTH_PX),
  );
  const [workbenchFraction, setWorkbenchFraction] = useState(
    clampWorkflowWorkbenchFraction(
      readStoredWorkflowWorkbenchFraction() ?? DEFAULT_WORKFLOW_WORKBENCH_FRACTION,
    ),
  );
  const workspaceSplitRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActivityLimit(ACTIVITY_PAGE_SIZE);
    setDeliverablesLimit(DELIVERABLES_PAGE_SIZE);
  }, [input.pageState.workflowId, input.pageState.workItemId]);

  useEffect(() => {
    if (!input.launchRequest.isRequested) {
      return;
    }
    setLaunchPlaybookId(input.launchRequest.playbookId);
    setLaunchWorkspaceId(null);
    setLaunchWorkflowName(null);
    setLaunchParameterDrafts({});
    setIsLaunchOpen(true);
    input.navigate(buildWorkflowsPageHref({}, input.pageState), { replace: true });
  }, [input.launchRequest.isRequested, input.launchRequest.playbookId, input.navigate, input.pageState]);

  useEffect(() => {
    writeStoredWorkflowRailHidden(isRailHidden);
  }, [isRailHidden]);

  useEffect(() => {
    writeStoredWorkflowRailWidth(railWidthPx);
  }, [railWidthPx]);

  useEffect(() => {
    writeStoredWorkflowWorkbenchFraction(workbenchFraction);
  }, [workbenchFraction]);

  const openWorkflowLaunchDialog = () => {
    setLaunchPlaybookId(null);
    setLaunchWorkspaceId(null);
    setLaunchWorkflowName(null);
    setLaunchParameterDrafts({});
    setIsLaunchOpen(true);
  };

  const handleSelectWorkItem = (workItemId: string) => {
    patchPageState(input.navigate, input.pageState, { workItemId, tab: 'details' });
  };

  const handleClearWorkItemScope = () => {
    patchPageState(input.navigate, input.pageState, { workItemId: null });
  };

  const handleLaunchOpenChange = (open: boolean) => {
    setIsLaunchOpen(open);
    if (!open) {
      setLaunchPlaybookId(null);
      setLaunchWorkspaceId(null);
      setLaunchWorkflowName(null);
      setLaunchParameterDrafts({});
    }
  };

  const handleAddWorkOpenChange = (open: boolean) => {
    setIsAddWorkOpen(open);
    if (!open) {
      setAddWorkTargetWorkItemId(null);
      setRepeatSourceWorkItemId(null);
    }
  };

  const handleSteeringOpenChange = (open: boolean) => {
    setIsSteeringOpen(open);
    if (!open) {
      setSteeringTargetWorkItemId(null);
    }
  };

  const handleRailResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    beginWorkflowRailResize({ event, railWidthPx, setRailWidthPx });
  };

  const handleWorkbenchResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    beginWorkflowWorkbenchResize({
      event,
      splitContainer: workspaceSplitRef.current,
      workbenchFraction,
      setWorkbenchFraction,
    });
  };

  return {
    activityLimit,
    addWorkTargetWorkItemId,
    deliverablesLimit,
    handleAddWorkOpenChange,
    handleClearWorkItemScope,
    handleLaunchOpenChange,
    handleRailResizePointerDown,
    handleSelectWorkItem,
    handleSteeringOpenChange,
    handleWorkbenchResizePointerDown,
    isAddWorkOpen,
    isLaunchOpen,
    isRailHidden,
    isSteeringOpen,
    launchParameterDrafts,
    launchPlaybookId,
    launchWorkflowName,
    launchWorkspaceId,
    openWorkflowLaunchDialog,
    railWidthPx,
    repeatSourceWorkItemId,
    setActivityLimit,
    setAddWorkTargetWorkItemId,
    setDeliverablesLimit,
    setIsAddWorkOpen,
    setIsLaunchOpen,
    setIsRailHidden,
    setIsSteeringOpen,
    setLaunchParameterDrafts,
    setLaunchPlaybookId,
    setLaunchWorkflowName,
    setLaunchWorkspaceId,
    setRepeatSourceWorkItemId,
    setSteeringTargetWorkItemId,
    steeringTargetWorkItemId,
    workbenchFraction,
    workspaceSplitRef,
  };
}
