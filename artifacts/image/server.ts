import { createDocumentHandler } from '@/lib/artifacts/server';

export const imageDocumentHandler = createDocumentHandler({
  kind: 'image',
  onCreateDocument: async ({ dataStream }) => {
    // Stub: image artifact creation
    return '';
  },
  onUpdateDocument: async ({ document, description, dataStream }) => {
    // Stub: image artifact update
    return document.content;
  },
});
