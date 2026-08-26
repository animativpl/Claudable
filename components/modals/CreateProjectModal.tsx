"use client";
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { TEMPLATE_META_LIST, DEFAULT_TEMPLATE_ID, type TemplateId } from '@/lib/templates/meta';
import { getModelDefinitionsForCli, getDefaultModelForCli, normalizeModelId } from '@/lib/constants/cliModels';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
const CLAUDE_MODELS = getModelDefinitionsForCli(null);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultModel?: string;
}

export default function CreateProjectModal({ isOpen, onClose, defaultModel }: CreateProjectModalProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>(DEFAULT_TEMPLATE_ID);
  const [selectedModel, setSelectedModel] = useState(defaultModel ?? getDefaultModelForCli(null));
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setProjectId('');
      setIdManuallyEdited(false);
      setSelectedTemplate(DEFAULT_TEMPLATE_ID);
      setSelectedModel(defaultModel ?? getDefaultModelForCli(null));
      setError(null);
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen, defaultModel]);

  useEffect(() => {
    if (!idManuallyEdited) {
      const slug = slugify(name);
      setProjectId(slug ? `project-${slug}` : '');
    }
  }, [name, idManuallyEdited]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleIdChange = (value: string) => {
    setProjectId(value);
    setIdManuallyEdited(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !projectId.trim() || isCreating) return;

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId.trim(),
          name: name.trim(),
          selectedModel,
          templateType: selectedTemplate,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? data?.detail ?? 'Failed to create project');
        setIsCreating(false);
        return;
      }

      const payload = await response.json();
      const projectData = payload?.data ?? payload;
      const createdId: string = projectData?.id ?? projectId.trim();

      const params = new URLSearchParams();
      if (selectedModel) params.set('model', selectedModel);
      router.push(`/${createdId}/chat${params.size ? '?' + params.toString() : ''}`);
    } catch {
      setError('Failed to create project. Please try again.');
      setIsCreating(false);
    }
  };

  const canSubmit = name.trim().length > 0 && projectId.trim().length > 0 && !isCreating;

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl"
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-8 w-full">
              <h2 className="text-xl font-bold text-gray-900 mb-5">New Project</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Project name
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Astro Blog"
                    disabled={isCreating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-[#DE7356] focus:border-transparent outline-none transition-all disabled:opacity-50"
                  />
                </div>

                {/* Project ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Project ID
                  </label>
                  <input
                    type="text"
                    value={projectId}
                    onChange={(e) => handleIdChange(e.target.value)}
                    placeholder="project-my-astro-blog"
                    disabled={isCreating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 placeholder:text-gray-400 font-mono text-sm focus:ring-2 focus:ring-[#DE7356] focus:border-transparent outline-none transition-all disabled:opacity-50"
                  />
                  <p className="mt-1 text-xs text-gray-400">Used as the project directory name</p>
                </div>

                {/* Template */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Template
                  </label>
                  <div className="flex gap-2">
                    {TEMPLATE_META_LIST.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplate(template.id)}
                        title={template.description}
                        className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                          selectedTemplate === template.id
                            ? 'border-[#DE7356] bg-[#DE7356]/10 text-[#DE7356]'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                        }`}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Model */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Model
                  </label>
                  <div className="relative" ref={modelDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowModelDropdown((v) => !v)}
                      className="w-full px-3 py-2 text-sm text-left border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50 flex items-center justify-between transition-colors"
                    >
                      <span>{CLAUDE_MODELS.find((m) => m.id === selectedModel)?.name ?? normalizeModelId(null, selectedModel)}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-400">
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </button>
                    {showModelDropdown && (
                      <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                        {CLAUDE_MODELS.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => { setSelectedModel(model.id); setShowModelDropdown(false); }}
                            className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                              selectedModel === model.id
                                ? 'bg-gray-100 font-semibold text-gray-900'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {model.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isCreating}
                    className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex-1 px-4 py-2 bg-[#DE7356] hover:bg-[#c85e42] disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {isCreating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Project'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
