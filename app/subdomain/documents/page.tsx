/**
 * Documents page for subdomain users
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AmeriVetLogo } from '@/components/amerivet-logo';
import { ArrowLeft, FileText, Download, Search, Calendar } from 'lucide-react';

interface Document {
  id: string;
  title: string;
  type: string;
  uploadedAt: string;
  size: string;
}

export default function DocumentsPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [documents] = useState<Document[]>([
    { id: '1', title: 'Medical Plan Summary 2025', type: 'PDF', uploadedAt: '2025-01-15', size: '2.4 MB' },
    { id: '2', title: 'Dental Coverage Guide', type: 'PDF', uploadedAt: '2025-01-10', size: '1.2 MB' },
    { id: '3', title: 'Vision Benefits Overview', type: 'PDF', uploadedAt: '2025-01-10', size: '890 KB' },
    { id: '4', title: '401(k) Plan Details', type: 'PDF', uploadedAt: '2024-12-20', size: '3.1 MB' },
    { id: '5', title: 'Employee Handbook 2025', type: 'PDF', uploadedAt: '2024-12-15', size: '5.6 MB' },
  ]);

  useEffect(() => {
    // Check auth
    fetch('/api/subdomain/auth/session', { credentials: 'include' })
      .then(res => !res.ok && router.push('/subdomain/login'))
      .catch(() => router.push('/subdomain/login'));
  }, [router]);

  const filteredDocuments = documents.filter(doc =>
    doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Temporary download map using public sample PDFs; replace with Azure Blob URLs later
  const urlForDoc = (id: string): string => {
    switch (id) {
      case '1':
        return 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
      case '2':
        return 'https://file-examples.com/storage/fe0f2e7df2f1b1f6c8e9b65/2017/10/file-example_PDF_500_kB.pdf';
      case '3':
        return 'https://www.orimi.com/pdf-test.pdf';
      case '4':
        return 'https://gahp.net/wp-content/uploads/2017/09/sample.pdf';
      case '5':
        return 'https://unec.edu.az/application/uploads/2014/12/pdf-sample.pdf';
      default:
        return 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      const url = urlForDoc(doc.id);
      // Use an anchor to respect browser download behavior
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.title}.pdf`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error('Download failed', e);
      alert('Unable to download the document right now. Please try again later.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center">
            <AmeriVetLogo
              alt="AmeriVet"
              width={40}
              height={40}
              className="w-10 h-10 mr-3 object-contain"
            />
            <Button variant="outline" onClick={() => router.push('/subdomain/dashboard')} className="mr-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <h1 className="text-2xl font-bold text-gray-900">AmeriVet Document Center</h1>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Search Documents</CardTitle>
            <CardDescription>Find and download your benefit plan documents</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search by document name or type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {filteredDocuments.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-gray-500">
                No documents found matching your search.
              </CardContent>
            </Card>
          ) : (
            filteredDocuments.map((doc) => (
              <Card key={doc.id} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="bg-purple-100 p-3 rounded-lg">
                        <FileText className="w-6 h-6 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{doc.title}</h3>
                        <div className="flex items-center space-x-4 mt-1">
                          <span className="text-sm text-gray-500 flex items-center">
                            <Calendar className="w-3 h-3 mr-1" />
                            {new Date(doc.uploadedAt).toLocaleDateString()}
                          </span>
                          <span className="text-sm text-gray-500">{doc.type}</span>
                          <span className="text-sm text-gray-500">{doc.size}</span>
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleDownload(doc)}>
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">Need a specific document?</h3>
          <p className="text-sm text-blue-800">
            Contact HR at hr@amerivet.com or use the AI Chat Assistant to find information about specific benefits.
          </p>
        </div>
      </main>
    </div>
  );
}
