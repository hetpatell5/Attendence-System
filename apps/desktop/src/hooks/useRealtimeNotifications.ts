import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';
import { useAuthStore } from '@/state/auth-store';
import { getApiBaseUrl } from '@/lib/api-client';

/** Show a native Windows notification toast in bottom-right corner via Electron */
function showNativeNotification(title: string, body: string): void {
  const electronApi = (window as any).electronApi;
  if (electronApi?.notify?.show) {
    void electronApi.notify.show(title, body);
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

function requestNotificationPermission(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

async function getToken(): Promise<string | null> {
  const electronApi = (window as any).electronApi;
  if (electronApi?.auth?.getAccessToken) {
    return electronApi.auth.getAccessToken() as Promise<string | null>;
  }
  return null;
}

/**
 * useRealtimeNotifications
 *
 * - Listens for LIVE SSE events to show native Windows bottom-right toasts in real-time
 * - Never replays or loops old historical notifications
 * - Polling keeps badge count in sync silently
 */
export function useRealtimeNotifications(): { unreadCount: number } {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const shownRef = useRef<Set<string>>(new Set());

  // Silent polling for badge count only
  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 5_000,
    enabled: !!user,
  });

  // Handle incoming live push event from backend
  const handleEvent = useCallback((raw: string) => {
    try {
      const data = JSON.parse(raw) as {
        id?: string;
        title?: string;
        body?: string;
        entityId?: string;
        type?: string;
      };
      if (!data.title) return;

      const key = data.id || `${data.type}:${data.title}:${data.body}`;

      // Prevent duplicate toast for the exact same event
      if (!shownRef.current.has(key)) {
        shownRef.current.add(key);
        if (shownRef.current.size > 200) {
          const first = shownRef.current.values().next().value as string;
          shownRef.current.delete(first);
        }

        // Show single native Windows toast banner in bottom right
        showNativeNotification(data.title, data.body ?? '');

        // Invalidate notification queries to refresh bell icon and list
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }
    } catch {
      // Ignore parse errors
    }
  }, [queryClient]);

  // Reset shown tracker on user change / login
  useEffect(() => {
    shownRef.current.clear();
  }, [user?.id]);

  // SSE Realtime push connection
  useEffect(() => {
    if (!user) return;
    requestNotificationPermission();

    let cancelled = false;
    let es: EventSource | null = null;

    const connect = async () => {
      const token = await getToken();
      if (cancelled) return;

      const baseUrl = getApiBaseUrl();
      const url = token
        ? `${baseUrl}/notifications/stream?token=${encodeURIComponent(token)}`
        : `${baseUrl}/notifications/stream`;

      try {
        es = new EventSource(url);
        eventSourceRef.current = es;

        const onMsg = (e: MessageEvent) => {
          handleEvent(typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
        };

        es.onmessage = onMsg;
        es.addEventListener('notification', onMsg);
        es.addEventListener('message', onMsg);

        es.onerror = () => {
          es?.close();
          if (!cancelled) {
            setTimeout(() => { if (!cancelled) void connect(); }, 5_000);
          }
        };
      } catch {
        // EventSource not available
      }
    };

    void connect();

    return () => {
      cancelled = true;
      es?.close();
      eventSourceRef.current = null;
    };
  }, [user, handleEvent]);

  return { unreadCount: unreadData?.count ?? 0 };
}
