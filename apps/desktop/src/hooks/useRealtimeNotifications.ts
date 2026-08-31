import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';
import { useAuthStore } from '@/state/auth-store';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Show a native Windows notification via Electron, or fall back to browser Notification API */
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
 * - Connects to `/notifications/stream` SSE endpoint with Bearer token in query param
 * - Shows native OS notification toast for every new push event
 * - Polls unread count every 30 seconds as a safety net
 */
export function useRealtimeNotifications(): { unreadCount: number } {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const shownRef = useRef<Set<string>>(new Set());

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 30_000,
    enabled: !!user,
  });

  const handleEvent = useCallback((raw: string) => {
    try {
      const data = JSON.parse(raw) as {
        title?: string;
        body?: string;
        entityId?: string;
        type?: string;
      };
      if (!data.title) return;

      const key = data.entityId ? `${data.type}:${data.entityId}` : `${data.title}:${Date.now()}`;

      if (!shownRef.current.has(key)) {
        shownRef.current.add(key);
        if (shownRef.current.size > 200) {
          const first = shownRef.current.values().next().value as string;
          shownRef.current.delete(first);
        }

        showNativeNotification(data.title, data.body ?? '');
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }
    } catch {
      // Ignore parse errors
    }
  }, [queryClient]);

  useEffect(() => {
    if (!user) return;
    requestNotificationPermission();

    let cancelled = false;
    let es: EventSource | null = null;

    const connect = async () => {
      const token = await getToken();
      if (cancelled) return;

      const url = token
        ? `${API_URL}/notifications/stream?token=${encodeURIComponent(token)}`
        : `${API_URL}/notifications/stream`;

      try {
        es = new EventSource(url);
        eventSourceRef.current = es;

        const onMsg = (e: MessageEvent) => handleEvent(typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
        es.addEventListener('notification', onMsg);
        es.addEventListener('message', onMsg);

        es.onerror = () => {
          es?.close();
          // Reconnect after 10 seconds on error
          if (!cancelled) {
            setTimeout(() => { if (!cancelled) void connect(); }, 10_000);
          }
        };
      } catch {
        // EventSource not available — polling only
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
