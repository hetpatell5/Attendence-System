import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';

type UpdateState = 'idle' | 'available' | 'downloaded';

/**
 * Listens for electron-updater events and shows a slim banner when an update
 * is downloading or ready to install. Completely hidden in the browser / dev.
 */
export function UpdateBanner(): JSX.Element | null {
  const [state, setState] = useState<UpdateState>('idle');
  const [version, setVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const electronApi = (window as any).electronApi;
    if (!electronApi?.updater) return; // browser / dev — do nothing

    const offAvailable = electronApi.updater.onUpdateAvailable((info: { version: string }) => {
      setVersion(info.version);
      setState('available');
      setDismissed(false);
    });

    const offDownloaded = electronApi.updater.onUpdateDownloaded((info: { version: string }) => {
      setVersion(info.version);
      setState('downloaded');
      setDismissed(false);
    });

    return () => {
      offAvailable();
      offDownloaded();
    };
  }, []);

  if (state === 'idle' || dismissed) return null;

  const isReady = state === 'downloaded';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 text-xs font-semibold border-b select-none ${
        isReady
          ? 'bg-emerald-600 text-white border-emerald-700'
          : 'bg-sky-600 text-white border-sky-700'
      }`}
    >
      {isReady ? (
        <RefreshCw size={13} className="shrink-0 animate-spin" />
      ) : (
        <Download size={13} className="shrink-0 animate-bounce" />
      )}

      <span className="flex-1">
        {isReady
          ? `✅ Version ${version} is ready — restart the app to apply the update.`
          : `⬇️ Downloading update v${version} in the background…`}
      </span>

      {isReady && (
        <button
          onClick={() => (window as any).electronApi?.updater?.installNow()}
          className="px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 transition-colors font-bold text-xs"
        >
          Restart Now
        </button>
      )}

      <button
        onClick={() => setDismissed(true)}
        className="opacity-70 hover:opacity-100 transition-opacity ml-1"
        title="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}
