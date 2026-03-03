export const DiffType: {
  Inserted: string;
  Deleted: string;
  Modified: string;
  Unchanged: string;
};

export function diffEditor(schema: any, oldDoc: any, newDoc: any): any;
export function patchDocumentNode(schema: any, oldNode: any, newNode: any): any;
export function patchTextNodes(schema: any, oldNode: any, newNode: any): any;
export function computeChildEqualityFactor(node1: any, node2: any): number;
export function createDiffNode(schema: any, node: any, type: string): any;
export function createDiffMark(schema: any, type: string): any;
