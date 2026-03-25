export type SelectorCandidate = {
  type: string;
  value: string;
  score: number;
  primary?: boolean;
};

export type RecorderFrame = {
  isTop?: boolean;
  url?: string;
  path?: string[];
};

export type RecorderPage = {
  url?: string;
  title?: string;
};

export type RecorderEventAction = "navigate" | "click" | "input" | "select";

export type RecorderEvent = {
  id?: string;
  timestamp: string;
  action: RecorderEventAction | string;
  selector?: string;
  selectorCandidates?: SelectorCandidate[];
  value?: string;
  text?: string;
  inputType?: string;
  page?: RecorderPage;
  frame?: RecorderFrame;
};

export type RecorderPayload = {
  source?: string;
  schemaVersion?: string;
  tabId?: number;
  exportedAt?: string;
  events: RecorderEvent[];
};

export type RecorderImportStrategy = "preview" | "replace" | "append";

export type RecorderPreview = {
  eventCount: number;
  generatedNodeCount: number;
  generatedEdgeCount: number;
  conflictResolvedCount: number;
  warnings: string[];
};
