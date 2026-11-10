'use client';
import { useEffect } from 'react';
import { projectSchema } from '@paperlens/shared';
import { api } from '@/lib/api';
type Context = {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function WebMCP() {
  useEffect(() => {
    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'create_research_project',
          description:
            'Create a private PaperLens research project and navigate to its upload workspace.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 120 },
              description: { type: 'string', maxLength: 2000 },
            },
            required: ['name'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input) {
            const value = projectSchema.parse(input);
            const p = await api('/projects', { method: 'POST', body: JSON.stringify(value) });
            window.location.assign(`/projects/${p.id}`);
            return { id: p.id, name: p.name };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  return null;
}
