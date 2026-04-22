import { NextResponse } from 'next/server';
import { BlobServiceClient } from '@azure/storage-blob';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    return NextResponse.json({ error: 'AZURE_STORAGE_CONNECTION_STRING not set' }, { status: 503 });
  }

  try {
    const client = BlobServiceClient.fromConnectionString(connectionString);

    // List all containers first so we know what exists
    const containers: string[] = [];
    for await (const c of client.listContainers()) {
      containers.push(c.name);
    }

    // List blobs in every container
    const result: Record<string, { name: string; url: string; contentType: string | undefined; sizeBytes: number }[]> = {};

    for (const containerName of containers) {
      const container = client.getContainerClient(containerName);
      result[containerName] = [];
      for await (const blob of container.listBlobsFlat()) {
        result[containerName].push({
          name: blob.name,
          url: `${container.url}/${blob.name}`,
          contentType: blob.properties.contentType,
          sizeBytes: blob.properties.contentLength ?? 0,
        });
      }
    }

    return NextResponse.json({ containers, blobs: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
