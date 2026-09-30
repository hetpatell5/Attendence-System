import { create } from 'zustand';

function readPersistedCollapsed(): boolean {
  try {
    return localStorage.getItem('atten_sidebar_collapsed') === '1';
  } catch {
    return false;
  }
}

interface UiState {
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  isSidebarCollapsed: readPersistedCollapsed(),
  toggleSidebar: () => {
    const next = !get().isSidebarCollapsed;
    try {
      localStorage.setItem('atten_sidebar_collapsed', next ? '1' : '0');
    } catch {}
    set({ isSidebarCollapsed: next });
  },
}));
