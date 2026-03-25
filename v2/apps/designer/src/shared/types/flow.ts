import type { FlowModel } from "@rpa/flow-schema/generated/types";

export type FlowStatus = "draft" | "published";

export type FlowCatalogItem = {
  flowId: string;
  name: string;
  status: FlowStatus;
  updatedAt: string;
};

export type StoredFlowRecord = {
  flow: FlowModel;
  status: FlowStatus;
  updatedAt: string;
};
