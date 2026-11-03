export async function getPublishedBuild(fetcher = fetch) {
  const response = await fetcher(`/app-version.json?check=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Could not check the published app version.');
  const version = await response.json();
  if (typeof version.buildId !== 'string' || !version.buildId.trim()) throw new Error('Invalid published app version.');
  return version.buildId;
}
