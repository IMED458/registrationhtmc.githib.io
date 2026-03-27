import { useEffect } from 'react';

const VERSION_CHECK_INTERVAL_MS = 60_000;

function buildVersionUrl() {
  return `${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`;
}

function redirectToLatestVersion(nextVersion: string) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('app-build', nextVersion);
  window.location.replace(nextUrl.toString());
}

export function useAppVersionSync() {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let isDisposed = false;
    let isReloadScheduled = false;

    const checkForUpdate = async () => {
      if (isDisposed || isReloadScheduled) {
        return;
      }

      try {
        const response = await fetch(buildVersionUrl(), {
          cache: 'no-store',
          headers: {
            'cache-control': 'no-cache',
          },
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { version?: string };
        const nextVersion = payload?.version?.trim();

        if (nextVersion && nextVersion !== __APP_BUILD_VERSION__) {
          isReloadScheduled = true;
          redirectToLatestVersion(nextVersion);
        }
      } catch (error) {
        console.warn('App version check failed:', error);
      }
    };

    const handleFocus = () => {
      void checkForUpdate();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void checkForUpdate();
      }
    };

    void checkForUpdate();

    const intervalId = window.setInterval(() => {
      void checkForUpdate();
    }, VERSION_CHECK_INTERVAL_MS);

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
}
