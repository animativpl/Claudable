/**
 * Service Settings Component
 * Manage service integrations
 */
import React, { useState, useEffect, useCallback } from 'react';
import GitHubRepoModal from '@/components/modals/GitHubRepoModal';
import { GitHubIcon } from '@/components/icons/GitHubIcon';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface ServiceConnection {
  id: string;
  provider: string;
  status: string;
  service_data: any;
  created_at: string;
  updated_at?: string;
}

interface Service {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
  status: string;
  description: string;
  connection?: ServiceConnection;
}

interface ServiceSettingsProps {
  projectId: string;
  onOpenGlobalSettings?: () => void;
}

export function ServiceSettings({ projectId, onOpenGlobalSettings }: ServiceSettingsProps) {
  const [tokenStatus, setTokenStatus] = useState<{
    github: boolean | null;
  }>({
    github: null
  });
  const [services, setServices] = useState<Service[]>([
    {
      id: 'github',
      name: 'GitHub',
      icon: 'github',
      connected: false,
      status: 'disconnected',
      description: 'Connect to GitHub for version control and collaboration'
    }
  ]);

  const [gitHubModalOpen, setGitHubModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'github':
        return <GitHubIcon width={16} height={16} />;
      default:
        return null;
    }
  };

  // Load service connections from API
  const loadServiceConnections = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/services`);
      if (!response.ok) return;

      const connections: ServiceConnection[] = await response.json();

      // Update services with connection status
      setServices(prev => prev.map(service => {
        const connection = connections.find(conn => conn.provider === service.id);
        return {
          ...service,
          connected: !!connection,
          status: connection?.status || 'disconnected',
          connection,
        };
      }));
    } catch (error) {
      console.error('Failed to load service connections:', error);
    }
  }, [projectId]);

  // Check if tokens exist for all services
  const checkTokens = useCallback(async () => {
    try {
      const githubRes = await fetch(`${API_BASE}/api/tokens/github`);

      setTokenStatus({
        github: githubRes.ok
      });
    } catch (error) {
      console.error('Failed to check tokens:', error);
      setTokenStatus({
        github: false
      });
    }
  }, []);

  // Load connections and check tokens on mount
  useEffect(() => {
    loadServiceConnections();
    checkTokens();
  }, [loadServiceConnections, checkTokens]);

  const handleConnect = async (serviceId: string) => {
    if (serviceId === 'github') {
      setGitHubModalOpen(true);
      return;
    }

    // For other services, show placeholder
    alert(`${serviceId} integration not implemented yet.`);
  };

  const handleGitHubModalSuccess = () => {
    loadServiceConnections(); // Reload connections after GitHub connection
  };

  const handleDisconnect = async (serviceId: string) => {
    if (!confirm(`Disconnect from ${serviceId}?`)) return;

    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/services/${serviceId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        loadServiceConnections(); // Reload connections
      } else {
        alert(`Failed to disconnect from ${serviceId}`);
      }
    } catch (error) {
      console.error(`Error disconnecting from ${serviceId}:`, error);
      alert(`Failed to disconnect from ${serviceId}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-1">
          Service Integrations
        </h3>
        <p className="text-sm text-gray-600 mb-4">Connect GitHub with a consistent, polished experience.</p>

        <div className="space-y-4">
          {services.map(service => (
            <div
              key={service.id}
              className="relative group overflow-hidden rounded-2xl border border-gray-200/80 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 transition-all duration-200 hover:shadow-lg"
            >
              <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
              <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 justify-between">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl ring-1 ring-inset ring-gray-200 bg-gray-50 text-gray-700 flex items-center justify-center">
                    {getProviderIcon(service.icon)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-1 min-w-0">
                      <h4 className="text-[15px] font-semibold tracking-tight text-gray-900 ">
                        {service.name}
                      </h4>
                      {service.connected && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium text-emerald-700 bg-emerald-100 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Connected
                        </span>
                      )}
                      {!service.connected && tokenStatus[service.id as keyof typeof tokenStatus] === false && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium text-amber-700 bg-amber-100 whitespace-nowrap">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                          Token needed
                        </span>
                      )}
                    </div>

                    <div className="text-sm leading-6 text-gray-600 min-w-0">
                      {!service.connected ? (
                        <p className="truncate whitespace-nowrap sm:whitespace-normal sm:overflow-visible sm:max-w-[60ch]">
                          {service.description}
                        </p>
                      ) : (
                        <div className="text-gray-700 ">
                          {service.id === 'github' && service.connection?.service_data?.repo_url ? (
                            <div className="flex items-center gap-2">
                              <span className="shrink-0">Repository:</span>
                              <a
                                href={service.connection.service_data.repo_url}
                                target="_blank" rel="noopener noreferrer"
                                className="truncate font-mono text-blue-600 hover:underline"
                              >
                                {service.connection.service_data.repo_name || service.connection.service_data.repo_url}
                              </a>
                            </div>
                          ) : (
                            <span>Connected and ready to use</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:flex-shrink-0 w-full sm:w-auto sm:justify-end">
                    {service.connected ? (
                      <button
                        onClick={() => handleDisconnect(service.id)}
                        className="px-4 py-2 text-sm rounded-xl text-red-600 hover:text-red-700 border border-transparent hover:border-red-200 hover:bg-red-50 transition whitespace-nowrap w-full sm:w-auto"
                        disabled={isLoading}
                      >
                        Disconnect
                      </button>
                    ) : tokenStatus[service.id as keyof typeof tokenStatus] === false ? (
                      <button
                        onClick={() => { if (onOpenGlobalSettings) onOpenGlobalSettings(); }}
                        className="px-4 py-2.5 text-sm rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition flex items-center justify-center gap-2 whitespace-nowrap w-full sm:w-auto"
                        disabled={isLoading}
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                        Setup Token
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(service.id)}
                        className="px-4 py-2.5 text-sm rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition disabled:opacity-50 whitespace-nowrap w-full sm:w-auto"
                        disabled={isLoading || tokenStatus[service.id as keyof typeof tokenStatus] === null}
                      >
                        {tokenStatus[service.id as keyof typeof tokenStatus] === null ? 'Checking...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* GitHub Repository Modal */}
      {gitHubModalOpen && (
        <GitHubRepoModal
          isOpen={gitHubModalOpen}
          onClose={() => setGitHubModalOpen(false)}
          projectId={projectId}
          projectName={projectId} // Use projectId as fallback project name
          onSuccess={handleGitHubModalSuccess}
        />
      )}
    </div>
  );
}
