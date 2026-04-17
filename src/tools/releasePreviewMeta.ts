import type { ReleasePreviewRecommendation } from '../types/index.js';

export function buildReleaseRecommendation(candidateCount: number): ReleasePreviewRecommendation {
  if (candidateCount === 0) {
    return {
      recommendedChoice: null,
      recommendationHint: 'No releases found.'
    };
  }
  return {
    recommendedChoice: 1,
    recommendationHint:
      'Options are sorted by seeders (highest first). Recommend option 1 unless the user wants a smaller download or a specific quality.'
  };
}
