import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential, SASProtocol } from '@azure/storage-blob';

const isBuild = () => process.env.NEXT_PHASE === 'phase-production-build';

export interface StorageFile {
  url: string;
  fileName: string;
  name: string;
}

let cachedServices: ReturnType<typeof createStorageServices> | null = null;

function createStorageServices(blobServiceClient: BlobServiceClient) {
  return {
    documents: {
      uploadFile: async (file: Buffer, fileName: string, contentType: string): Promise<StorageFile> => {
        const containerClient = blobServiceClient.getContainerClient('documents');
        await containerClient.createIfNotExists();
        const blockBlobClient = containerClient.getBlockBlobClient(fileName);
        await blockBlobClient.uploadData(file, { 
          blobHTTPHeaders: { blobContentType: contentType } 
        });
        return { 
          url: blockBlobClient.url, 
          fileName,
          name: fileName
        };
      },
      
      deleteFile: async (fileName: string): Promise<void> => {
        const containerClient = blobServiceClient.getContainerClient('documents');
        const blockBlobClient = containerClient.getBlockBlobClient(fileName);
        await blockBlobClient.deleteIfExists();
      },
      
      getFileUrl: (fileName: string): string => {
        const containerClient = blobServiceClient.getContainerClient('documents');
        const blockBlobClient = containerClient.getBlockBlobClient(fileName);
        return blockBlobClient.url;
      },
      
      downloadFile: async (fileName: string): Promise<Buffer> => {
        const containerClient = blobServiceClient.getContainerClient('documents');
        const blockBlobClient = containerClient.getBlockBlobClient(fileName);
        const downloadResponse = await blockBlobClient.download();
        const chunks: Uint8Array[] = [];
        for await (const chunk of downloadResponse.readableStreamBody!) {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(Buffer.from(chunk)));
        }
        return Buffer.concat(chunks);
      },

      generateUploadUrl: async (blobName: string, contentType: string): Promise<string> => {
        const containerClient = blobServiceClient.getContainerClient('documents');
        await containerClient.createIfNotExists();
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        
        // Try to generate SAS token with proper permissions
        // Fall back to the blob URL if credential extraction fails (e.g., managed identity)
        try {
          const accountName = blobServiceClient.accountName;
          const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
          const keyMatch = connectionString.match(/AccountKey=([^;]+)/);
          
          if (accountName && keyMatch?.[1]) {
            const sharedKeyCredential = new StorageSharedKeyCredential(accountName, keyMatch[1]);
            const startsOn = new Date();
            const expiresOn = new Date(startsOn.getTime() + 30 * 60 * 1000); // 30 min
            
            const sasToken = generateBlobSASQueryParameters({
              containerName: 'documents',
              blobName,
              permissions: BlobSASPermissions.parse('cw'), // create + write
              startsOn,
              expiresOn,
              contentType,
              protocol: SASProtocol.Https,
            }, sharedKeyCredential).toString();
            
            return `${blockBlobClient.url}?${sasToken}`;
          }
        } catch {
          // Fall through to direct URL
        }
        
        return blockBlobClient.url;
      },
    },
    images: {
      uploadFile: async (file: Buffer, fileName: string, contentType: string): Promise<StorageFile> => {
        const containerClient = blobServiceClient.getContainerClient('images');
        await containerClient.createIfNotExists();
        const blockBlobClient = containerClient.getBlockBlobClient(fileName);
        await blockBlobClient.uploadData(file, { 
          blobHTTPHeaders: { blobContentType: contentType } 
        });
        return { 
          url: blockBlobClient.url, 
          fileName,
          name: fileName
        };
      },
      
      deleteFile: async (fileName: string): Promise<void> => {
        const containerClient = blobServiceClient.getContainerClient('images');
        const blockBlobClient = containerClient.getBlockBlobClient(fileName);
        await blockBlobClient.deleteIfExists();
      },
      
      getFileUrl: (fileName: string): string => {
        const containerClient = blobServiceClient.getContainerClient('images');
        const blockBlobClient = containerClient.getBlockBlobClient(fileName);
        return blockBlobClient.url;
      },
    },
  };
}

export const getStorageServices = () => {
  if (isBuild()) {
    throw new Error('Storage services unavailable during build');
  }
  
  if (cachedServices) return cachedServices;
  
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is not defined in environment variables.');
  }
  
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  cachedServices = createStorageServices(blobServiceClient);
  return cachedServices;
};
