/** Pending storage deletes leave a retryable feed row, but no report evidence. */
export function selectVisibleClips<Feed extends { id: string }, Recent extends { id: string }>(
  allFeed: Feed[], allRecent: Recent[], deletingIds: Set<string>, shared: boolean,
) {
  const clips = allFeed.filter((clip) => !deletingIds.has(clip.id)).slice(0, 60);
  const recent = allRecent.filter((clip) => !deletingIds.has(clip.id)).slice(0, 5);
  const feedClips = shared ? clips : allFeed.slice(0, 60);
  return { clips, recent, feedClips };
}
