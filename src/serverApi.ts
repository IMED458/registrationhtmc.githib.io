const configuredApiBaseUrl = import.meta.env.VITE_SERVER_API_BASE_URL?.trim().replace(/\/$/, '') || '';

export function resolveServerApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (configuredApiBaseUrl) {
    return `${configuredApiBaseUrl}${normalizedPath}`;
  }

  if (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')) {
    return null;
  }

  return normalizedPath;
}
