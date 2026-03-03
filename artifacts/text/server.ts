import { createDocumentHandler } from '@/lib/artifacts/server';

export const textDocumentHandler = createDocumentHandler({
  kind: 'text',
  onCreateDocument: async ({ dataStream }) => {
    // Stub: text artifact creation
    return '';
  },
  onUpdateDocument: async ({ document, description, dataStream }) => {
    // Stub: text artifact update
    return document.content;
  },
});
