import { createDocumentHandler } from '@/lib/artifacts/server';

export const sheetDocumentHandler = createDocumentHandler({
  kind: 'sheet',
  onCreateDocument: async ({ dataStream }) => {
    // Stub: sheet artifact creation
    return '';
  },
  onUpdateDocument: async ({ document, description, dataStream }) => {
    // Stub: sheet artifact update
    return document.content;
  },
});
