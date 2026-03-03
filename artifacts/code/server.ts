import { createDocumentHandler } from '@/lib/artifacts/server';

export const codeDocumentHandler = createDocumentHandler({
  kind: 'code',
  onCreateDocument: async ({ dataStream }) => {
    // Stub: code artifact creation
    return '';
  },
  onUpdateDocument: async ({ document, description, dataStream }) => {
    // Stub: code artifact update
    return document.content;
  },
});
