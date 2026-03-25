import type {
  FlowEdge,
  FlowModel,
  FlowNode,
  NodeType,
  RunEvent,
  RunResult,
  ValidateResponse
} from "@rpa/flow-schema/generated/types";

import type { RunOptionsPayload } from "../../core/api/runs";
import type {
  RecorderImportStrategy,
  RecorderPayload,
  RecorderPreview
} from "../../shared/types/recorder";
import type { ApiError } from "../../shared/types/api";
import type { AlertRecord, RunStatsResponse, TaskDefinition } from "../../shared/types/task";

export type VersionMode = "draft" | "published" | "rollback";
export type ElementPickerMode = "desktop_native" | "extension_manual" | "extension_bridge";

export type FlowVersionRecord = {
  id: string;
  label: string;
  mode: VersionMode;
  createdAt: string;
  sourceVersionId?: string;
  flow: FlowModel;
};

export type ValidationState = ValidateResponse | ApiError | null;
export type RunState = RunResult | ApiError | null;
export type NodePlacement = {
  x: number;
  y: number;
};

export type DesignerState = {
  flow: FlowModel;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  validationState: ValidationState;
  runState: RunState;
  runEvents: RunEvent[];
  lastRunId: string | null;
  versions: FlowVersionRecord[];
  runOptions: Required<RunOptionsPayload>;
  recorderPayload: RecorderPayload | null;
  recorderPreview: RecorderPreview | null;
  recorderImportStrategy: RecorderImportStrategy;
  recorderPayloadText: string;
  isValidating: boolean;
  isRunning: boolean;
  panelMessage: string;
  panelError: string;
  tasks: TaskDefinition[];
  runStats: RunStatsResponse | null;
  alerts: AlertRecord[];
  isTaskLoading: boolean;
  taskTotal: number;
  taskPage: number;
  taskPageSize: number;
  taskName: string;
  taskIntervalSeconds: number;
};

export type DesignerActions = {
  setFlowName: (name: string) => void;
  setFlowId: (id: string) => void;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  addNode: (type: NodeType, position?: NodePlacement) => void;
  addNodeFromSource: (sourceNodeId: string, type: NodeType, position?: NodePlacement) => void;
  insertNodeOnEdge: (edgeId: string, type: NodeType) => void;
  removeNode: (nodeId: string) => void;
  updateNode: (nodeId: string, patch: Partial<FlowNode>) => void;
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  updateNodeConfig: (nodeId: string, key: string, value: unknown) => void;
  replaceNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  addEdge: (source: string, target: string, condition?: string) => void;
  updateEdge: (edgeId: string, patch: Partial<FlowEdge>) => void;
  removeEdge: (edgeId: string) => void;
  updateVariable: (key: string, value: string) => void;
  removeVariable: (key: string) => void;
  setRunOptions: (patch: Partial<Required<RunOptionsPayload>>) => void;
  setRecorderImportStrategy: (strategy: RecorderImportStrategy) => void;
  setRecorderPayloadText: (text: string) => void;
  requestRecorderPayloadFromExtension: () => void;
  startElementPicker: (nodeId: string, url: string, mode?: ElementPickerMode) => void;
  loadRecorderPayloadFromText: () => void;
  loadRecorderPayloadFromFile: (file: File) => Promise<void>;
  applyRecorderImport: () => void;
  clearRecorderImport: () => void;
  validateFlow: () => Promise<void>;
  runFlow: () => Promise<string | null>;
  runOfflineSelfCheck: () => Promise<string | null>;
  refreshTaskCenter: () => Promise<void>;
  setTaskPage: (page: number) => void;
  setTaskPageSize: (size: number) => void;
  setTaskName: (name: string) => void;
  setTaskIntervalSeconds: (seconds: number) => void;
  createCurrentFlowTask: () => Promise<void>;
  triggerTask: (taskId: string) => Promise<void>;
  pauseTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  disableTask: (taskId: string) => Promise<void>;
  retryLastFailedTask: (taskId: string) => Promise<void>;
  clearPanelMessage: () => void;
  saveDraft: (label?: string) => void;
  publishVersion: (label?: string) => void;
  rollbackToVersion: (versionId: string) => void;
};
