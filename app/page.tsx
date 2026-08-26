"use client";
import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import DeleteProjectModal from '@/components/modals/DeleteProjectModal';
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import GlobalSettings from '@/components/settings/GlobalSettings';
import { useGlobalSettings } from '@/contexts/GlobalSettingsContext';
import { getDefaultModelForCli, getModelDisplayName, normalizeModelId } from '@/lib/constants/cliModels';
import type { Project as ProjectSummary } from '@/types/project';

// Ensure fetch is available
const fetchAPI = globalThis.fetch || fetch;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

// Claude is the only agent, so its brand color is used unconditionally.
const CLAUDE_BRAND_COLOR = '#DE7356';


export default function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [globalSettingsTab, setGlobalSettingsTab] = useState<'general' | 'ai-assistant'>('ai-assistant');
  const [editingProject, setEditingProject] = useState<ProjectSummary | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; project: ProjectSummary | null }>({ isOpen: false, project: null });
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const DEFAULT_MODEL = getDefaultModelForCli(null);

  const normalizeProjectPayload = useCallback((project: any): ProjectSummary => {
    const selected = normalizeModelId(null, project?.selectedModel ?? project?.selected_model);

    return {
      id: project.id,
      name: project.name,
      description: project.description ?? null,
      status: project.status,
      previewUrl: project.previewUrl ?? project.preview_url ?? null,
      createdAt: project.createdAt ?? project.created_at ?? new Date().toISOString(),
      updatedAt: project.updatedAt ?? project.updated_at,
      lastActiveAt: project.lastActiveAt ?? project.last_active_at ?? null,
      lastMessageAt: project.lastMessageAt ?? project.last_message_at ?? null,
      initialPrompt: project.initialPrompt ?? project.initial_prompt ?? null,
      services: project.services,
      selectedModel: selected,
    };
  }, []);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [usingGlobalDefaults, setUsingGlobalDefaults] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Sync with Global Settings (until user overrides locally)
  const { settings: globalSettings } = useGlobalSettings();
  
  // Check if this is a fresh page load (not navigation)
  useEffect(() => {
    const isPageRefresh = !sessionStorage.getItem('navigationFlag');
    
    if (isPageRefresh) {
      // Fresh page load or refresh - use global defaults
      sessionStorage.setItem('navigationFlag', 'true');
      setIsInitialLoad(true);
      setUsingGlobalDefaults(true);
    } else {
      // Navigation within session - check for stored selections
      const storedModelRaw = sessionStorage.getItem('selectedModel');

      if (storedModelRaw) {
        setSelectedModel(normalizeModelId(null, storedModelRaw));
        setUsingGlobalDefaults(false);
        setIsInitialLoad(false);
        return;
      }
    }

    // Clean up navigation flag on unmount
    return () => {
      // Don't clear on navigation, only on actual page unload
    };
  }, []);

  // Apply global settings when using defaults
  useEffect(() => {
    if (!usingGlobalDefaults || !isInitialLoad) return;

    const modelFromGlobal = globalSettings?.cli_settings?.claude?.model;
    setSelectedModel(normalizeModelId(null, modelFromGlobal));
  }, [globalSettings, usingGlobalDefaults, isInitialLoad]);

  // Save selections to sessionStorage when they change
  useEffect(() => {
    if (!isInitialLoad && selectedModel) {
      sessionStorage.setItem('selectedModel', normalizeModelId(null, selectedModel));
    }
  }, [selectedModel, isInitialLoad]);

  // Clear navigation flag on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      sessionStorage.removeItem('navigationFlag');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);
  const router = useRouter();
  const prefetchTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Format time for display
  const formatTime = (dateString: string | null) => {
    if (!dateString) return 'Never';
    
    // Server sends UTC time without 'Z' suffix, so we need to add it
    // to ensure it's parsed as UTC, not local time
    let utcDateString = dateString;
    
    // Check if the string has timezone info
    const hasTimezone = dateString.endsWith('Z') || 
                       dateString.includes('+') || 
                       dateString.match(/[-+]\d{2}:\d{2}$/);
    
    if (!hasTimezone) {
      // Add 'Z' to indicate UTC
      utcDateString = dateString + 'Z';
    }
    
    // Parse the date as UTC
    const date = new Date(utcDateString);
    const now = new Date();
    // Calculate the actual time difference
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  const formatFullTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const load = useCallback(async () => {
    try {
      const r = await fetchAPI(`${API_BASE}/api/projects`);
      if (!r.ok) {
        console.warn('Failed to load projects: HTTP', r.status);
        setProjects([]);
        return;
      }

      const payload = await r.json();
      if (payload?.success === false) {
        console.error('Failed to load projects:', payload?.error || payload?.message);
        setProjects([]);
        return;
      }

      const items: unknown[] = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
        ? payload
        : [];

      const normalized: ProjectSummary[] = items
        .filter((project): project is Record<string, unknown> => Boolean(project && typeof project === 'object'))
        .map((project) => normalizeProjectPayload(project));

      const sortedProjects = normalized.sort((a, b) => {
        const aTime = a.lastMessageAt ?? a.createdAt;
        const bTime = b.lastMessageAt ?? b.createdAt;
        if (!aTime) return 1;
        if (!bTime) return -1;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      setProjects(sortedProjects);
    } catch (error) {
      console.warn('Failed to load projects:', error);
      setProjects([]);
    }
  }, [normalizeProjectPayload]);
  
  async function start(projectId: string) {
    try {
      await fetchAPI(`${API_BASE}/api/projects/${projectId}/preview/start`, { method: 'POST' });
      await load();
    } catch (error) {
      console.warn('Failed to start project:', error);
    }
  }
  
  async function stop(projectId: string) {
    try {
      await fetchAPI(`${API_BASE}/api/projects/${projectId}/preview/stop`, { method: 'POST' });
      await load();
    } catch (error) {
      console.warn('Failed to stop project:', error);
    }
  }

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const openDeleteModal = (project: ProjectSummary) => {
    setDeleteModal({ isOpen: true, project });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, project: null });
  };

  async function deleteProject() {
    if (!deleteModal.project) return;
    
    setIsDeleting(true);
    try {
      const response = await fetchAPI(`${API_BASE}/api/projects/${deleteModal.project.id}`, { method: 'DELETE' });
      
      if (response.ok) {
        showToast('Project deleted successfully', 'success');
        await load();
        closeDeleteModal();
      } else {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to delete project' }));
        showToast(errorData.detail || 'Failed to delete project', 'error');
      }
    } catch (error) {
      console.warn('Failed to delete project:', error);
      showToast('Failed to delete project. Please try again.', 'error');
    } finally {
      setIsDeleting(false);
    }
  }

  async function updateProject(projectId: string, newName: string) {
    try {
      const response = await fetchAPI(`${API_BASE}/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      
      if (response.ok) {
        showToast('Project updated successfully', 'success');
        await load();
        setEditingProject(null);
      } else {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to update project' }));
        showToast(errorData.detail || 'Failed to update project', 'error');
      }
    } catch (error) {
      console.warn('Failed to update project:', error);
      showToast('Failed to update project. Please try again.', 'error');
    }
  }

  useEffect(() => {
    load();
    const timers = prefetchTimers.current;
    return () => {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, [load]);


  return (
    <div className="flex h-screen relative overflow-hidden bg-white ">
      {/* Radial gradient background from bottom center */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-white " />
        <div
          className="absolute inset-0 hidden transition-all duration-1000 ease-in-out"
          style={{
            background: `radial-gradient(circle at 50% 100%,
              ${CLAUDE_BRAND_COLOR}66 0%,
              ${CLAUDE_BRAND_COLOR}4D 25%,
              ${CLAUDE_BRAND_COLOR}33 50%,
              transparent 70%)`
          }}
        />
        {/* Light mode gradient - subtle */}
        <div
          className="absolute inset-0 block transition-all duration-1000 ease-in-out"
          style={{
            background: `radial-gradient(circle at 50% 100%,
              ${CLAUDE_BRAND_COLOR}40 0%,
              ${CLAUDE_BRAND_COLOR}26 25%,
              transparent 50%)`
          }}
        />
      </div>
      
      {/* Content wrapper */}
      <div className="relative z-10 flex h-full w-full">
        {/* Thin sidebar bar when closed */}
        <div className={`${sidebarOpen ? 'w-0' : 'w-12'} fixed inset-y-0 left-0 z-40 bg-transparent border-r border-gray-200/20 transition-all duration-300 flex flex-col`}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-full h-12 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            title="Open sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          
          {/* Settings button when sidebar is closed */}
          <div className="mt-auto mb-2">
            <button
              onClick={() => setShowGlobalSettings(true)}
              className="w-full h-12 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              title="Settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
        
        {/* Sidebar - Overlay style */}
        <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 w-64 bg-white/95 backdrop-blur-2xl border-r border-gray-200 transition-transform duration-300`}>
        <div className="flex flex-col h-full">
          {/* History header with close button */}
          <div className="p-3 border-b border-gray-200 ">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 px-2 py-1">
                <h2 className="text-gray-900 font-medium text-lg">History</h2>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                title="Close sidebar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {projects.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-sm">No conversations yet</p>
                </div>
              ) : (
                projects.map((project) => {
                  const projectColor = CLAUDE_BRAND_COLOR;
                  return (
                    <div 
                      key={project.id}
                      className="p-2 px-3 rounded-lg transition-all group"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = `${projectColor}15`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {editingProject?.id === project.id ? (
                      // Edit mode
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const formData = new FormData(e.target as HTMLFormElement);
                          const newName = formData.get('name') as string;
                          if (newName.trim()) {
                            updateProject(project.id, newName.trim());
                          }
                        }}
                        className="space-y-2"
                      >
                        <input
                          name="name"
                          defaultValue={project.name}
                          className="w-full px-2 py-1 text-sm bg-white border border-gray-300 rounded text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                          autoFocus
                          onBlur={() => setEditingProject(null)}
                        />
                        <div className="flex gap-1">
                          <button
                            type="submit"
                            className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingProject(null)}
                            className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      // View mode
                      <div className="flex items-center justify-between gap-2">
                        <div 
                          className="flex-1 cursor-pointer min-w-0"
                          onClick={() => {
                            // Pass current model selection when navigating from sidebar
                            const params = new URLSearchParams();
                            if (selectedModel) params.set('model', selectedModel);
                            router.push(`/${project.id}/chat${params.toString() ? '?' + params.toString() : ''}`);
                          }}
                        >
                          <h3 
                            className="text-gray-900 text-sm transition-colors truncate"
                            style={{
                              '--hover-color': projectColor || '#DE7356'
                            } as React.CSSProperties}
                          >
                            <span 
                              className="group-hover:text-[var(--hover-color)]"
                              style={{
                                transition: 'color 0.2s'
                              }}
                            >
                              {project.name.length > 28 
                                ? `${project.name.substring(0, 28)}...` 
                                : project.name
                              }
                            </span>
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="text-gray-500 text-xs">
                              {formatTime(project.lastMessageAt || project.createdAt)}
                            </div>
                            {project.selectedModel && (
                              <div className="flex items-center gap-1">
                                <span className="text-gray-400 text-xs">•</span>
                                <span
                                  className="text-xs transition-colors"
                                  style={{
                                    color: (projectColor || '#6B7280') + 'CC'
                                  }}
                                >
                                  {getModelDisplayName(null, project.selectedModel)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingProject(project);
                            }}
                            className="p-1 text-gray-400 hover:text-orange-500 transition-colors"
                            title="Edit project name"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openDeleteModal(project);
                            }}
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                            title="Delete project"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          
          <div className="p-2 border-t border-gray-200 ">
            <button 
              onClick={() => setShowGlobalSettings(true)}
              className="w-full flex items-center gap-2 p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all text-sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Settings
            </button>
          </div>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <h1
              className="font-extrabold tracking-tight select-none mb-4"
              style={{
                fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                color: CLAUDE_BRAND_COLOR,
                letterSpacing: '-0.06em',
                fontWeight: 800,
                fontSize: '72px',
                lineHeight: '72px',
              }}
            >
              Claudable
            </h1>
            <p className="text-xl text-gray-700 font-light tracking-tight mb-10">
              Connect CLI Agent • Build what you want • Preview instantly
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#DE7356] hover:bg-[#c85e42] text-white font-semibold rounded-2xl shadow-lg transition-colors text-base"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              New Project
            </button>
          </div>
        </div>
      </div>

      {/* Global Settings Modal */}
      <GlobalSettings
        isOpen={showGlobalSettings}
        onClose={() => setShowGlobalSettings(false)}
      />

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        defaultModel={selectedModel}
      />

      {/* Delete Project Modal */}
      <DeleteProjectModal
        isOpen={deleteModal.isOpen}
        projectName={deleteModal.project?.name ?? ''}
        onClose={closeDeleteModal}
        onConfirm={deleteProject}
        isDeleting={isDeleting}
      />

      {/* Toast Messages */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
          >
            <div className={`px-6 py-4 rounded-lg shadow-lg border flex items-center gap-3 max-w-sm backdrop-blur-lg ${
              toast.type === 'success'
                ? 'bg-green-500/20 border-green-500/30 text-green-400'
                : 'bg-red-500/20 border-red-500/30 text-red-400'
            }`}>
              {toast.type === 'success' ? (
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
              <p className="text-sm font-medium">{toast.message}</p>
            </div>
          </motion.div>
        </div>
      )}
      </div>
    </div>
  );
}
