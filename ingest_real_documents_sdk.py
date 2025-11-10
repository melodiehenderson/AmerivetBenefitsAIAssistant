#!/usr/bin/env python3
"""
Ingest real benefits documents from Azure Blob Storage to Azure Search (SDK-based)
Uses BlobServiceClient to handle spaces in blob names and avoids 409 errors.
"""

import os
import json
import sys
import io
from pathlib import Path
from azure.storage.blob import BlobServiceClient
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
import PyPDF2
from docx import Document

# ============================================================================
# Configuration
# ============================================================================

env_file = Path(r"C:\Users\sonal\secrets\benefitsaichatbot-383\.env.production")
env = {}
for line in env_file.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

STORAGE_CS = env.get("AZURE_STORAGE_CONNECTION_STRING", "") or os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
CONTAINER_NAME = "documents"
COMPANY_ID = "amerivet"

# Azure OpenAI for embeddings
AOAI_ENDPOINT = (env.get("AZURE_OPENAI_ENDPOINT", "") or os.environ.get("AZURE_OPENAI_ENDPOINT", "")).rstrip("/")
AOAI_API_KEY = env.get("AZURE_OPENAI_API_KEY", "") or os.environ.get("AZURE_OPENAI_API_KEY", "")
EMB_DEPLOY = env.get("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "") or os.environ.get("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-large")

# Azure Search
SEARCH_ENDPOINT = (env.get("AZURE_SEARCH_ENDPOINT", "") or os.environ.get("AZURE_SEARCH_ENDPOINT", "")).rstrip("/")
SEARCH_KEY = env.get("AZURE_SEARCH_API_KEY", "") or os.environ.get("AZURE_SEARCH_API_KEY", "")
INDEX_NAME = env.get("AZURE_SEARCH_INDEX_NAME", "") or os.environ.get("AZURE_SEARCH_INDEX_NAME", "chunks_prod_v1")

print(f"📋 Configuration:")
print(f"  - Storage: {STORAGE_CS[:50]}...")
print(f"  - Container: {CONTAINER_NAME}")
print(f"  - Search Index: {INDEX_NAME}")
print(f"  - Company: {COMPANY_ID}")

# ============================================================================
# Azure Clients
# ============================================================================

blob_service = BlobServiceClient.from_connection_string(STORAGE_CS)
container_client = blob_service.get_container_client(CONTAINER_NAME)
search_client = SearchClient(
    endpoint=SEARCH_ENDPOINT,
    index_name=INDEX_NAME,
    credential=AzureKeyCredential(SEARCH_KEY)
)

print("✓ Azure clients initialized")

# ============================================================================
# Text Extraction
# ============================================================================

def extract_pdf_text(data: bytes) -> str:
    """Extract text from PDF bytes"""
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(data))
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        print(f"  ⚠️  PDF extraction failed: {e}")
        return ""

def extract_docx_text(data: bytes) -> str:
    """Extract text from DOCX bytes"""
    try:
        doc = Document(io.BytesIO(data))
        text = "\n".join(paragraph.text for paragraph in doc.paragraphs)
        return text.strip()
    except Exception as e:
        print(f"  ⚠️  DOCX extraction failed: {e}")
        return ""

# ============================================================================
# Embedding Generation
# ============================================================================

from openai import AzureOpenAI

# Initialize Azure OpenAI client once (reuse across all calls)
aoai_client = AzureOpenAI(
    api_key=AOAI_API_KEY,
    api_version="2024-02-15-preview",
    azure_endpoint=AOAI_ENDPOINT
)

def generate_embedding(text: str) -> list:
    """Generate 3072-dimensional embedding using Azure OpenAI"""
    response = aoai_client.embeddings.create(
        input=text,
        model=EMB_DEPLOY
    )
    return response.data[0].embedding

def generate_embeddings_batch(texts: list) -> list:
    """Generate embeddings for multiple texts in one API call"""
    if not texts:
        return []
    
    # Azure OpenAI can handle batches up to 16 texts
    batch_size = 16
    all_embeddings = []
    
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        response = aoai_client.embeddings.create(
            input=batch,
            model=EMB_DEPLOY
        )
        all_embeddings.extend([item.embedding for item in response.data])
    
    return all_embeddings

# ============================================================================
# Chunking
# ============================================================================

def chunk_text(text: str, chunk_size: int = 1024, overlap: int = 256) -> list:
    """Split text into overlapping chunks"""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap
    return chunks

# ============================================================================
# Blob Download & Processing
# ============================================================================

def process_blob(blob_name: str, data: bytes) -> list:
    """Extract text, chunk, and embed a blob"""
    print(f"\n📄 Processing: {blob_name}")
    
    # Extract text based on file type
    text = ""
    if blob_name.lower().endswith(".pdf"):
        text = extract_pdf_text(data)
    elif blob_name.lower().endswith(".docx"):
        text = extract_docx_text(data)
    else:
        print(f"  ⚠️  Unsupported format: {blob_name}")
        return []
    
    if not text:
        print(f"  ⚠️  No text extracted")
        return []
    
    print(f"  ✓ Extracted {len(text)} chars")
    
    # Chunk text
    chunks = chunk_text(text)
    print(f"  ✓ Created {len(chunks)} chunks")
    
    # Generate stable doc_id for this source file (one per document)
    import hashlib
    stable_doc_id = f"doc-{hashlib.md5(blob_name.encode()).hexdigest()[:12]}"
    print(f"  ✓ Assigned doc_id: {stable_doc_id}")
    
    # Generate embeddings in batch for all chunks at once
    print(f"  ⏳ Generating embeddings for {len(chunks)} chunks...")
    try:
        embeddings = generate_embeddings_batch(chunks)
        print(f"  ✓ Generated {len(embeddings)} embeddings")
    except Exception as e:
        print(f"  ❌ Batch embedding failed: {e}")
        return []
    
    # Build search documents
    docs = []
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        chunk_id = f"{stable_doc_id}-chunk-{i}"
        
        docs.append({
            "chunk_id": chunk_id,
            "doc_id": stable_doc_id,  # Shared across all chunks from this file
            "document_id": blob_name,
            "company_id": COMPANY_ID,
            "chunk_index": i,
            "content": chunk,
            "content_vector": embedding,
            "metadata": json.dumps({
                "fileName": blob_name,
                "chunkIndex": i,
                "totalChunks": len(chunks),
                "tokenCount": len(chunk) // 4,
            })
        })
    
    print(f"  ✓ Built {len(docs)} search documents")
    return docs

# ============================================================================
# Upload to Search
# ============================================================================

def upload_docs(docs: list) -> int:
    """Upload documents to Azure Search"""
    if not docs:
        return 0
    
    try:
        # Upload in batches
        batch_size = 100
        uploaded = 0
        for i in range(0, len(docs), batch_size):
            batch = docs[i:i+batch_size]
            
            result = search_client.upload_documents(documents=batch)
            succeeded = sum(1 for r in result if r.succeeded)
            uploaded += succeeded
            print(f"    - Batch {i//batch_size + 1}: {succeeded}/{len(batch)} docs uploaded (total: {uploaded})")
        
        return uploaded
    except Exception as e:
        print(f"  ❌ Upload failed: {e}")
        import traceback
        traceback.print_exc()
        return 0

# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    
    print("\n" + "="*70)
    print("Azure Blob → Search Ingestion (SDK-based)")
    print("="*70)
    
    all_docs = []
    blob_count = 0
    
    try:
        # List and process all blobs in container
        for blob in container_client.list_blobs():
            blob_name = blob.name
            
            # Skip non-document files
            if not (blob_name.lower().endswith(".pdf") or blob_name.lower().endswith(".docx")):
                continue
            
            blob_count += 1
            
            try:
                # Download blob (SDK handles spaces in names)
                print(f"\n🔽 Downloading blob {blob_count}: {blob_name}")
                blob_data = container_client.download_blob(blob_name).readall()
                print(f"  ✓ Downloaded {len(blob_data)} bytes")
                
                # Process blob
                docs = process_blob(blob_name, blob_data)
                all_docs.extend(docs)
                
            except Exception as e:
                print(f"  ❌ Failed to process {blob_name}: {e}")
                continue
        
        # Upload all documents to Search
        print(f"\n{'='*70}")
        print(f"📤 Uploading {len(all_docs)} documents to {INDEX_NAME}...")
        uploaded = upload_docs(all_docs)
        
        print(f"\n{'='*70}")
        print(f"✅ Ingestion complete: {uploaded}/{len(all_docs)} docs uploaded")
        print(f"   Processed: {blob_count} blobs")
        print(f"{'='*70}")
        
    except Exception as e:
        print(f"\n❌ Ingestion failed: {e}")
        sys.exit(1)
