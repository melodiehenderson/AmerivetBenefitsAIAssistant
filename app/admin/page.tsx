'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '../../context/auth-context';
import { useRouter } from 'next/navigation';
import { logger } from '../../lib/logger';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Badge } from '../../components/ui/badge';
import {
  Users,
  FileText,
  Building2,
  BarChart3,
  Settings,
  Activity,
  Database,
  Shield,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  Clock,
} from 'lucide-react';

const BenefitsDashboard = dynamic(
  () => import('../../components/benefits-dashboard').then((mod) => mod.BenefitsDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Loading benefits insights...
      </div>
    ),
  },
);

interface SystemStats {
  totalUsers: number;
  totalCompanies: number;
  totalDocuments: number;
  activeSessions: number;
  systemHealth: 'healthy' | 'warning' | 'critical';
  lastBackup: string;
  storageUsed: number;
  storageTotal: number;
}

interface RecentActivity {
  id: string;
  type: 'user_login' | 'document_upload' | 'company_created' | 'error' | 'backup';
  message: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'error';
}

export default function AdminDashboard() {
  const { account, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (!loading && !account) {
      router.push('/login');
      return;
    }
  }, [account, loading, router]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoadingStats(true);
        // TODO: Replace with actual API calls
        // const response = await fetch('/api/admin/stats');
        // const data = await response.json();
        
        // Mock data for demonstration
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        setStats({
          totalUsers: 1247,
          totalCompanies: 23,
          totalDocuments: 1843,
          activeSessions: 45,
          systemHealth: 'healthy',
          lastBackup: '2024-01-20T14:30:00Z',
          storageUsed: 2.3,
          storageTotal: 10.0,
        });

        setRecentActivity([
          {
            id: '1',
            type: 'user_login',
            message: 'New user registered: john.doe@company.com',
            timestamp: '2024-01-20T15:30:00Z',
            severity: 'info',
          },
          {
            id: '2',
            type: 'document_upload',
            message: 'Document uploaded: benefits-guide-2024.pdf',
            timestamp: '2024-01-20T15:25:00Z',
            severity: 'info',
          },
          {
            id: '3',
            type: 'company_created',
            message: 'New company registered: TechCorp Inc.',
            timestamp: '2024-01-20T15:20:00Z',
            severity: 'info',
          },
          {
            id: '4',
            type: 'backup',
            message: 'Daily backup completed successfully',
            timestamp: '2024-01-20T14:30:00Z',
            severity: 'info',
          },
          {
            id: '5',
            type: 'error',
            message: 'Failed to process document: corrupted-file.pdf',
            timestamp: '2024-01-20T14:15:00Z',
            severity: 'warning',
          },
        ]);
      } catch (error) {
        logger.error('Failed to fetch admin stats:', error);
      } finally {
        setLoadingStats(false);
      }
    };

    if (account) {
      fetchStats();
    }
  }, [account]);

  if (loading || loadingStats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  if (!account) {
    return null;
  }

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'error':
        return <AlertTriangle className="size-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="size-4 text-yellow-500" />;
      default:
        return <CheckCircle className="size-4 text-green-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error':
        return 'text-red-600 bg-red-50';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-green-600 bg-green-50';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className="space-y-6 p-6 relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 bg-clip-text text-transparent mb-2">
              Admin Dashboard
            </h1>
            <p className="text-gray-400 text-lg">
              System overview and management for {account?.name || 'Admin'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={stats?.systemHealth === 'healthy' ? 'default' : 'destructive'}
              className="flex items-center gap-2 px-4 py-2 text-base bg-gradient-to-r from-green-500/20 to-green-600/20 border border-green-500/50 text-green-300"
            >
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              {stats?.systemHealth === 'healthy' ? 'System Healthy' : 'System Issues'}
            </Badge>
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm">
            <TabsTrigger value="overview" className="data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-300">Overview</TabsTrigger>
            <TabsTrigger value="activity" className="data-[state=active]:bg-purple-600/20 data-[state=active]:text-purple-300">Activity</TabsTrigger>
            <TabsTrigger value="system" className="data-[state=active]:bg-green-600/20 data-[state=active]:text-green-300">System</TabsTrigger>
            <TabsTrigger value="comments" className="data-[state=active]:bg-orange-600/20 data-[state=active]:text-orange-300">Comments</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Stats Cards */}
            {stats && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Users Card */}
                <Card className="group relative border-0 bg-gradient-to-br from-blue-900/40 to-blue-800/20 backdrop-blur-sm hover:from-blue-900/60 hover:to-blue-800/40 transition-all duration-300 shadow-lg hover:shadow-2xl hover:shadow-blue-500/20">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 via-transparent to-blue-500/0 group-hover:from-blue-500/10 group-hover:to-blue-500/5 rounded-lg transition-opacity" />
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative">
                    <CardTitle className="text-sm font-medium text-gray-300">Total Users</CardTitle>
                    <Users className="size-5 text-blue-400" />
                  </CardHeader>
                  <CardContent className="relative">
                    <div className="text-3xl font-bold text-white">{stats.totalUsers.toLocaleString()}</div>
                    <p className="text-xs text-green-400 mt-1">
                      ↑ +12% from last month
                    </p>
                  </CardContent>
                </Card>

                {/* Companies Card */}
                <Card className="group relative border-0 bg-gradient-to-br from-purple-900/40 to-purple-800/20 backdrop-blur-sm hover:from-purple-900/60 hover:to-purple-800/40 transition-all duration-300 shadow-lg hover:shadow-2xl hover:shadow-purple-500/20">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 via-transparent to-purple-500/0 group-hover:from-purple-500/10 group-hover:to-purple-500/5 rounded-lg transition-opacity" />
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative">
                    <CardTitle className="text-sm font-medium text-gray-300">Companies</CardTitle>
                    <Building2 className="size-5 text-purple-400" />
                  </CardHeader>
                  <CardContent className="relative">
                    <div className="text-3xl font-bold text-white">{stats.totalCompanies}</div>
                    <p className="text-xs text-green-400 mt-1">
                      ↑ +2 this week
                    </p>
                  </CardContent>
                </Card>

                {/* Documents Card */}
                <Card className="group relative border-0 bg-gradient-to-br from-emerald-900/40 to-emerald-800/20 backdrop-blur-sm hover:from-emerald-900/60 hover:to-emerald-800/40 transition-all duration-300 shadow-lg hover:shadow-2xl hover:shadow-emerald-500/20">
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 via-transparent to-emerald-500/0 group-hover:from-emerald-500/10 group-hover:to-emerald-500/5 rounded-lg transition-opacity" />
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative">
                    <CardTitle className="text-sm font-medium text-gray-300">Documents</CardTitle>
                    <FileText className="size-5 text-emerald-400" />
                  </CardHeader>
                  <CardContent className="relative">
                    <div className="text-3xl font-bold text-white">{stats.totalDocuments.toLocaleString()}</div>
                    <p className="text-xs text-green-400 mt-1">
                      ↑ +8% from last month
                    </p>
                  </CardContent>
                </Card>

                {/* Sessions Card */}
                <Card className="group relative border-0 bg-gradient-to-br from-orange-900/40 to-orange-800/20 backdrop-blur-sm hover:from-orange-900/60 hover:to-orange-800/40 transition-all duration-300 shadow-lg hover:shadow-2xl hover:shadow-orange-500/20">
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-500/0 via-transparent to-orange-500/0 group-hover:from-orange-500/10 group-hover:to-orange-500/5 rounded-lg transition-opacity" />
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative">
                    <CardTitle className="text-sm font-medium text-gray-300">Active Sessions</CardTitle>
                    <Activity className="size-5 text-orange-400 animate-pulse" />
                  </CardHeader>
                  <CardContent className="relative">
                    <div className="text-3xl font-bold text-white">{stats.activeSessions}</div>
                    <p className="text-xs text-orange-300 mt-1">
                      Currently online
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Quick Actions */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="border-0 bg-gradient-to-br from-slate-800/60 to-slate-700/60 backdrop-blur-sm shadow-lg">
                <CardHeader>
                  <CardTitle className="text-blue-300">⚡ Quick Actions</CardTitle>
                  <CardDescription className="text-gray-400">Common administrative tasks</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start bg-slate-700/50 hover:bg-blue-600/50 border-slate-600 hover:border-blue-400 text-gray-300 hover:text-blue-200 transition-all">
                    <Users className="mr-2 size-4" />
                    Manage Users
                  </Button>
                  <Button variant="outline" className="w-full justify-start bg-slate-700/50 hover:bg-purple-600/50 border-slate-600 hover:border-purple-400 text-gray-300 hover:text-purple-200 transition-all">
                    <Building2 className="mr-2 size-4" />
                    Manage Companies
                  </Button>
                  <Button variant="outline" className="w-full justify-start bg-slate-700/50 hover:bg-emerald-600/50 border-slate-600 hover:border-emerald-400 text-gray-300 hover:text-emerald-200 transition-all">
                    <FileText className="mr-2 size-4" />
                    View Documents
                  </Button>
                  <Button variant="outline" className="w-full justify-start bg-slate-700/50 hover:bg-orange-600/50 border-slate-600 hover:border-orange-400 text-gray-300 hover:text-orange-200 transition-all">
                    <BarChart3 className="mr-2 size-4" />
                    View Analytics
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-0 bg-gradient-to-br from-slate-800/60 to-slate-700/60 backdrop-blur-sm shadow-lg">
                <CardHeader>
                  <CardTitle className="text-purple-300">🔧 System Status</CardTitle>
                  <CardDescription className="text-gray-400">Current system health and metrics</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-sm font-medium text-gray-300">System Health</span>
                    <Badge variant={stats?.systemHealth === 'healthy' ? 'default' : 'destructive'} className="bg-gradient-to-r from-green-500/30 to-emerald-500/30 border border-green-500/50 text-green-300">
                      {stats?.systemHealth === 'healthy' ? '✓ Healthy' : 'Issues'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-sm font-medium text-gray-300">Storage Usage</span>
                    <span className="text-sm text-blue-300 font-semibold">
                      {stats?.storageUsed}GB / {stats?.storageTotal}GB
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-sm font-medium text-gray-300">Last Backup</span>
                    <span className="text-sm text-purple-300 font-semibold">
                      {stats?.lastBackup ? new Date(stats.lastBackup).toLocaleDateString() : 'Never'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-0 bg-gradient-to-br from-slate-800/60 to-slate-700/60 backdrop-blur-sm shadow-lg">
              <CardHeader>
                <CardTitle className="text-emerald-300">📊 Benefits Snapshot</CardTitle>
                <CardDescription className="text-gray-400">Live employee metrics powered by the benefits API</CardDescription>
              </CardHeader>
              <CardContent>
                <BenefitsDashboard />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="space-y-4">
            <Card className="border-0 bg-gradient-to-br from-slate-800/60 to-slate-700/60 backdrop-blur-sm shadow-lg">
              <CardHeader>
                <CardTitle className="text-orange-300">📋 Recent Activity</CardTitle>
                <CardDescription className="text-gray-400">Latest system events and user actions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentActivity.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50 hover:border-slate-600/50 transition-colors">
                      {getSeverityIcon(activity.severity)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-200">{activity.message}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(activity.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant="outline" className={`${getSeverityColor(activity.severity)} whitespace-nowrap`}>
                        {activity.type.replace('_', ' ')}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="system" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-0 bg-gradient-to-br from-slate-800/60 to-slate-700/60 backdrop-blur-sm shadow-lg">
                <CardHeader>
                  <CardTitle className="text-blue-300">🗄️ Database Status</CardTitle>
                  <CardDescription className="text-gray-400">Database health and performance</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-sm font-medium text-gray-300">Connection Status</span>
                    <Badge className="bg-green-500/20 border border-green-500/50 text-green-300">Connected</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-sm font-medium text-gray-300">Response Time</span>
                    <span className="text-sm text-green-400 font-semibold">45ms</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-sm font-medium text-gray-300">Active Connections</span>
                    <span className="text-sm text-blue-400 font-semibold">12/100</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 bg-gradient-to-br from-slate-800/60 to-slate-700/60 backdrop-blur-sm shadow-lg">
                <CardHeader>
                  <CardTitle className="text-emerald-300">💾 Storage Status</CardTitle>
                  <CardDescription className="text-gray-400">File storage and backup status</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-sm font-medium text-gray-300">Storage Used</span>
                    <span className="text-sm text-purple-400 font-semibold">
                      {stats?.storageUsed}GB / {stats?.storageTotal}GB
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-sm font-medium text-gray-300">Backup Status</span>
                    <Badge className="bg-green-500/20 border border-green-500/50 text-green-300">Up to Date</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-sm font-medium text-gray-300">Last Backup</span>
                    <span className="text-sm text-orange-400 font-semibold">
                      {stats?.lastBackup ? new Date(stats.lastBackup).toLocaleString() : 'Never'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="comments" className="space-y-4">
            <Card className="border-0 bg-gradient-to-br from-slate-800/60 to-slate-700/60 backdrop-blur-sm shadow-lg">
              <CardHeader>
                <CardTitle className="text-yellow-300">💬 System Comments & Notes</CardTitle>
                <CardDescription className="text-gray-400">Administrative comments and system notes</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-slate-900/50 rounded-lg border border-blue-500/30 hover:border-blue-500/50 transition-colors">
                    <MessageSquare className="size-5 text-blue-400 mt-1 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-blue-200">System Maintenance</span>
                        <Badge variant="outline" className="bg-blue-500/20 border-blue-500/50 text-blue-300">Info</Badge>
                        <span className="text-xs text-gray-500">
                          {new Date().toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">
                        Scheduled maintenance completed successfully. All systems are running normally.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-4 bg-slate-900/50 rounded-lg border border-yellow-500/30 hover:border-yellow-500/50 transition-colors">
                    <AlertTriangle className="size-5 text-yellow-400 mt-1 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-yellow-200">Storage Warning</span>
                        <Badge variant="outline" className="bg-yellow-500/20 border-yellow-500/50 text-yellow-300">Warning</Badge>
                        <span className="text-xs text-gray-500">
                          {new Date(Date.now() - 86400000).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">
                        Storage usage is approaching 80% capacity. Consider cleaning up old files or upgrading storage plan.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-4 bg-slate-900/50 rounded-lg border border-green-500/30 hover:border-green-500/50 transition-colors">
                    <CheckCircle className="size-5 text-green-400 mt-1 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-green-200">Security Update</span>
                        <Badge variant="outline" className="bg-green-500/20 border-green-500/50 text-green-300">Success</Badge>
                        <span className="text-xs text-gray-500">
                          {new Date(Date.now() - 172800000).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">
                        Security patches applied successfully. All systems are up to date and secure.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 p-4 border-2 border-dashed border-slate-600 rounded-lg hover:border-slate-500 transition-colors">
                    <div className="text-center">
                      <MessageSquare className="size-8 text-gray-500 mx-auto mb-2" />
                      <p className="text-sm text-gray-400 mb-3">
                        Add a new comment or note
                      </p>
                      <Button variant="outline" size="sm" className="bg-slate-700/50 border-slate-600 hover:bg-blue-600/50 hover:border-blue-400 text-gray-300 hover:text-blue-200">
                        + Add Comment
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
