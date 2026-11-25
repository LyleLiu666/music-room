export const yueMemoryMinimum = 8 * 2 ** 30;

/** Reservation for the pinned low-memory runtime, using the context check's upper bounds. */
export function yueMemoryBudget(preset: 'fast' | 'quality', instrumental: boolean, context: {
  prefixTokens: number; planningTokens: number; semanticTokens: number; contextTokens: number;
}) {
  const {prefixTokens, planningTokens, semanticTokens, contextTokens} = context;
  const scorePrefix = prefixTokens + planningTokens;
  const cacheBytesPerToken = 28 * 8 * 128 * 2 * 2; // layers × heads × head dimension × K/V × BF16 bytes
  // The planning cache is smaller than the semantic cache. CFG keeps a second cache
  // whose prompt is shorter, so the positive length bounds both allocations.
  const semanticCache = (scorePrefix + semanticTokens) * (instrumental ? 2 : 1) * cacheBytesPerToken;
  // The MLX runtime prefills every acoustic chunk before releasing the BF16 backbone.
  const chunkSize = Math.floor((contextTokens - scorePrefix - 3) / 2);
  const acousticChunks = Math.ceil(semanticTokens / chunkSize);
  const acousticCache = (acousticChunks * (scorePrefix + 1) + semanticTokens) * cacheBytesPerToken;
  // Allow for weights, adapters, temporary tensors and the process outside the caches.
  const bf16Allowance = 6.25 * 2 ** 30;
  const semanticAllowance = preset === 'fast' ? 4.75 * 2 ** 30 : bf16Allowance;
  return Math.max(yueMemoryMinimum, semanticAllowance + semanticCache, bf16Allowance + acousticCache);
}
