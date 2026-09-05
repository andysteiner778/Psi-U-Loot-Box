'use client';

import React, { useState } from 'react';
import { Package, Sparkles, Box } from 'lucide-react';

interface ClearanceTabContainerProps {
  clearanceActive: boolean;
  clearanceNode: React.ReactNode;
  standardBoxesNode: React.ReactNode;
}

export function ClearanceTabContainer({
  clearanceActive,
  clearanceNode,
  standardBoxesNode,
}: ClearanceTabContainerProps) {
  // If clearance mode is active, default to clearance tab, otherwise standard boxes
  const [activeTab, setActiveTab] = useState<'clearance' | 'standard'>(
    clearanceActive ? 'clearance' : 'standard'
  );

  if (!clearanceActive) {
    return <>{standardBoxesNode}</>;
  }

  return (
    <div className="space-y-6">
      {/* Clearance Mode Navigation Switcher */}
      <div className="flex items-center justify-between border-b border-gun-800 pb-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('clearance')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 font-mono text-xs font-black tracking-wide transition ${
              activeTab === 'clearance'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-600/30'
                : 'border border-gun-750 bg-gun-900 text-gun-400 hover:text-white hover:border-gun-700'
            }`}
          >
            <Package className="h-4 w-4 text-cyan-300" />
            <span>CLEARANCE &amp; CUSTOM BOXES</span>
            <span className="rounded bg-black/40 px-1.5 py-0.5 text-[9px] uppercase font-bold text-cyan-300">
              Live
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('standard')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 font-mono text-xs font-bold transition ${
              activeTab === 'standard'
                ? 'bg-gun-800 text-white border border-gun-700 shadow-md'
                : 'border border-gun-800 bg-gun-950/60 text-gun-400 hover:text-white hover:border-gun-750'
            }`}
          >
            <Box className="h-4 w-4 text-purple-400" />
            <span>Standard Mystery Boxes</span>
          </button>
        </div>

        <span className="hidden sm:inline font-mono text-[11px] text-cyan-400/80">
          Party Clearance Active
        </span>
      </div>

      {activeTab === 'clearance' ? clearanceNode : standardBoxesNode}
    </div>
  );
}
