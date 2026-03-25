export type PickerSelectorType = "css" | "xpath" | "text" | "role" | "playwright";

export type PickerSelectorCandidate = {
  type: PickerSelectorType;
  value: string;
  score: number;
  primary: boolean;
};

export type PickerFrameSegment = {
  index: number;
  hint: string;
  tag?: string;
  name?: string;
  id?: string;
  idStable?: boolean;
  src?: string;
  srcHostPath?: string;
  srcStableFragment?: string;
  frameBorder?: string;
  selector?: string;
  crossOrigin?: boolean;
  attrHints?: Record<string, string>;
};

export type PickerFrameLocatorSegment = {
  depth: number;
  hint: string;
  crossOrigin: boolean;
  index: number;
  primary?: string;
  selectorCandidates: PickerSelectorCandidate[];
};

export type PickerResult = {
  selector: string;
  selectorType: PickerSelectorType;
  selectorCandidates: PickerSelectorCandidate[];
  playwrightPrimary?: PickerSelectorCandidate;
  playwrightCandidates?: PickerSelectorCandidate[];
  frameLocatorChain?: PickerFrameLocatorSegment[];
  pageUrl?: string;
  framePath?: PickerFrameSegment[];
  framePathString?: string;
  elementMeta?: Record<string, unknown>;
};
