/**
 * AI Assistant Settings Component
 * Display current model (read-only)
 */
import React, { useEffect, useState } from 'react';
import { getModelDisplayName } from '@/lib/constants/cliModels';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface AIAssistantSettingsProps {
  projectId: string;
}

export function AIAssistantSettings({ projectId }: AIAssistantSettingsProps) {
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/api/projects/${projectId}`)
      .then(response => (response.ok ? response.json() : null))
      .then(payload => {
        if (cancelled || !payload) return;
        const project = payload?.data ?? payload;
        setSelectedModel(typeof project?.selectedModel === 'string' ? project.selectedModel : null);
      })
      .catch(() => {
        if (!cancelled) setSelectedModel(null);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const modelDisplayName = selectedModel ? getModelDisplayName(selectedModel) : 'Default Model';

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Current AI Assistant
        </h3>

        <div className="space-y-4">
          {/* Current Model */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 mb-1">
              Model
            </h4>
            <span className="text-lg font-semibold text-gray-900 ">
              {modelDisplayName}
            </span>
          </div>


          {/* Note */}
          <div className="text-center">
            <p className="text-sm text-gray-500 ">
              To modify these settings, use Global Settings
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
