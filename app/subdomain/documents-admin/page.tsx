'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, Upload, FileText, Trash2, CheckCircle } from 'lucide-react';

export default function DocumentsAdminPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [documents, setDocuments] = useState<any[]>([
    { id: 1, name: 'Kaiser Medical Plans 2025', category: 'health', uploadedAt: '2024-11-01', chunks: 45 },
    { id: 2, name: 'Retirement Plans Guide', category: 'retirement', uploadedAt: '2024-11-02', chunks: 28 },
    { id: 3, name: 'Benefits Enrollment Timeline', category: 'enrollment', uploadedAt: '2024-11-03', chunks: 12 },
  ]);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/subdomain/auth/session', { credentials: 'include' });
      if (!response.ok) {
        router.push('/subdomain/login');
        return;
      }
      const data = await response.json();
      if (data.role === 'admin') {
        setIsAdmin(true);
      } else {
        router.push('/subdomain/dashboard');
      }
    } catch (err) {
      router.push('/subdomain/login');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadSuccess(false);
    setUploadMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'benefits');

      const response = await fetch('/api/subdomain/documents/upload-new', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        setUploadMessage(`Error: ${data.message || 'Upload failed'}`);
        return;
      }

      setUploadSuccess(true);
      setUploadMessage(`✓ ${file.name} uploaded with ${data.chunkCount} chunks indexed`);

      // Add to documents list
      setDocuments([
        {
          id: documents.length + 1,
          name: file.name,
          category: data.category,
          uploadedAt: new Date().toISOString().split('T')[0],
          chunks: data.chunkCount,
        },
        ...documents,
      ]);

      // Reset file input
      if (e.target) {
        e.target.value = '';
      }

      // Clear message after 5 seconds
      setTimeout(() => setUploadMessage(''), 5000);
    } catch (err) {
      setUploadMessage(`Error: ${err instanceof Error ? err.message : 'Upload failed'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = (docId: number, docName: string) => {
    if (confirm(`Delete "${docName}"? This cannot be undone.`)) {
      setDocuments(documents.filter(doc => doc.id !== docId));
      setUploadMessage(`✓ "${docName}" deleted successfully`);
      setTimeout(() => setUploadMessage(''), 3000);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>You must be an admin to access this page.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push('/subdomain/analytics')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold text-gray-900">Manage Documents</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Upload Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Upload New Document</CardTitle>
            <CardDescription>Add PDF documents to the knowledge base. Documents will be auto-chunked and immediately available to the bot.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition">
                <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p className="text-gray-600 mb-2">Drag and drop a PDF file here, or click to select</p>
                <p className="text-sm text-gray-500 mb-4">Max file size: 10MB</p>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                  id="file-input"
                />
                <label htmlFor="file-input">
                  <Button asChild disabled={uploading}>
                    <span>{uploading ? 'Uploading...' : 'Select PDF File'}</span>
                  </Button>
                </label>
              </div>

              {uploadMessage && (
                <Alert variant={uploadSuccess ? 'default' : 'destructive'}>
                  <AlertDescription className={uploadSuccess ? 'text-green-600' : ''}>
                    {uploadMessage}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Documents List */}
        <Card>
          <CardHeader>
            <CardTitle>Uploaded Documents ({documents.length})</CardTitle>
            <CardDescription>Currently indexed documents available to the bot</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {documents.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No documents uploaded yet</p>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3 flex-1">
                      <FileText className="w-5 h-5 text-blue-600" />
                      <div>
                        <p className="font-medium text-gray-900">{doc.name}</p>
                        <div className="flex gap-4 text-sm text-gray-500">
                          <span>Uploaded: {doc.uploadedAt}</span>
                          <span>{doc.chunks} chunks indexed</span>
                          <span className="capitalize bg-gray-100 px-2 py-0.5 rounded">{doc.category}</span>
                        </div>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => handleDeleteDocument(doc.id, doc.name)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Info Section */}
        <Card className="mt-8 bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-blue-900">How it Works</CardTitle>
          </CardHeader>
          <CardContent className="text-blue-800 space-y-2">
            <p>1. Upload a PDF document using the form above</p>
            <p>2. We remember it and make it available to the bot</p>
            <p>3. Ask questions in the normal chat section - the bot will use this information in its answers</p>
            <p>4. Use this to keep information up-to-date: new plans, phone numbers, deadlines, policy changes, etc.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
