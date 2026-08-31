import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes';

const queryClient = new QueryClient();

/** Restore keyboard shortcuts that Electron loses when the native menu is removed. */
function useElectronKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+Shift+R or Ctrl+F5 → hard reload (bypass cache)
      if (isCtrl && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        window.location.reload();
        return;
      }

      // Ctrl+R or F5 → soft reload
      if ((isCtrl && e.key === 'r') || e.key === 'F5') {
        e.preventDefault();
        window.location.reload();
        return;
      }

      // F12 or Ctrl+Shift+I → open DevTools via electronApi if available
      if (e.key === 'F12' || (isCtrl && e.shiftKey && e.key === 'I')) {
        e.preventDefault();
        // In production builds there's no DevTools; safe to ignore
        try {
          (window as any).electronApi?.openDevTools?.();
        } catch {
          // not available
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

export function App(): JSX.Element {
  useElectronKeyboardShortcuts();

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
