import type { ScoreDimension } from "./score.js";

/**
 * Fitness-for-purpose presets: what "good enough" means depends on what the data is
 * for. A profile changes the dimension weights and, for sharing, the export default.
 */
export type FitnessId = "general" | "finance" | "ml" | "sharing";

export interface FitnessProfile {
  id: FitnessId;
  label: string;
  description: string;
  weights: Record<ScoreDimension, number>;
  /** The export notice starts on Mask instead of Include. */
  exportMaskDefault: boolean;
}

export const FITNESS_PROFILES: readonly FitnessProfile[] = [
  {
    id: "general",
    label: "General analysis",
    description: "Balanced weights. The default.",
    weights: { completeness: 30, validity: 30, uniqueness: 15, consistency: 15, timeliness: 10, accuracy: 0 },
    exportMaskDefault: false,
  },
  {
    id: "finance",
    label: "Finance reporting",
    description: "Duplicates and wrong values cost money: uniqueness and accuracy count for more.",
    weights: { completeness: 20, validity: 25, uniqueness: 25, consistency: 15, timeliness: 5, accuracy: 10 },
    exportMaskDefault: false,
  },
  {
    id: "ml",
    label: "Machine learning",
    description: "Missing values hurt models most: completeness counts for more, timeliness for less.",
    weights: { completeness: 40, validity: 25, uniqueness: 10, consistency: 20, timeliness: 5, accuracy: 0 },
    exportMaskDefault: false,
  },
  {
    id: "sharing",
    label: "Sharing externally",
    description: "Same weights as general analysis, and exports start on Mask for possibly-sensitive columns.",
    weights: { completeness: 30, validity: 30, uniqueness: 15, consistency: 15, timeliness: 10, accuracy: 0 },
    exportMaskDefault: true,
  },
];

export function fitnessProfile(id: string | null | undefined): FitnessProfile {
  return FITNESS_PROFILES.find((profile) => profile.id === id) ?? FITNESS_PROFILES[0]!;
}

const KEY = "turbofuzz.fitness";

export function readFitnessId(): FitnessId {
  try {
    return fitnessProfile(localStorage.getItem(KEY)).id;
  } catch {
    return "general";
  }
}

export function saveFitnessId(id: FitnessId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Preference only.
  }
}
