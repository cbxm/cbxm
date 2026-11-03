export const stages = ['seedling', 'growing', 'evergreen'] as const;
export type Stage = (typeof stages)[number];
