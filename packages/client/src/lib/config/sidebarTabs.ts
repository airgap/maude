import type { SidebarTab } from '$lib/stores/ui.svelte';

export interface TabDefinition {
  id: SidebarTab;
  label: string;
  icon: string;
}

export const SIDEBAR_TABS: TabDefinition[] = [
  {
    id: 'conversations',
    label: 'Chats',
    icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  },
  {
    id: 'files',
    label: 'Files',
    icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  },
  {
    id: 'search',
    label: 'Search',
    icon: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: 'M4 7h16M4 12h10M4 17h6',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM12 16v-4M12 8h.01',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  },
  {
    id: 'mcp',
    label: 'MCP',
    icon: 'M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z',
  },
  {
    id: 'loop',
    label: 'Loop',
    icon: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  },
];

export function getTabDef(id: SidebarTab): TabDefinition {
  const tab = SIDEBAR_TABS.find((t) => t.id === id);
  if (!tab) {
    throw new Error(`Unknown sidebar tab: ${id}`);
  }
  return tab;
}
