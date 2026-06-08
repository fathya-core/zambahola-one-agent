import type { PredictionDirection } from "../types.js";
import { isHitRecoverMode } from "../learning/hit-recover-mode.js";
import type { LatentDirectionalSkew } from "./latent-consensus.js";

function countModelVoters(
  direction: PredictionDirection,
  mlProb: number,
  mlpProb: number,
  gbmProb: number,
): number {
  if (direction === "range") return 0;
  const agrees = (prob: number) =>
    direction === "up" ? prob > 0.55 : prob < 0.45;
  let n = 0;
  if (agrees(mlProb)) n += 1;
  if (agrees(mlpProb)) n += 1;
  if (agrees(gbmProb)) n += 1;
  return n;
}

export interface ExpertLeanResult {
  direction: PredictionDirection;
  confidence: number;
  qualityTier: "medium" | "high";
  reason: string;
}

/**
 * Expert lean — only promotes range→directional when S-tier + models + agreement align.
 * Avoids blind lean that caused 71% false positives.
 */
export function applyExpertDirectionalLean(opts: {
  direction: PredictionDirection;
  latent: LatentDirectionalSkew;
  tierSVotes: number;
  directionalAgreement: number;
  mlProb: number;
  mlpProb: number;
  gbmProb: number;
}): ExpertLeanResult | null {
  if (process.env.ZAMBAHOLA_HIT_RECOVER_S_LEAN === "0") return null;
  if (!isHitRecoverMode()) return null;
  if (opts.direction !== "range" || !opts.latent.candidate) return null;

  const minS = Number(process.env.ZAMBAHOLA_EXPERT_LEAN_MIN_S ?? 2);
  const minModels = Number(process.env.ZAMBAHOLA_EXPERT_LEAN_MIN_MODELS ?? 1);
  const minAgree = Number(process.env.ZAMBAHOLA_EXPERT_LEAN_MIN_AGREE ?? 0.55);

  const candidate = opts.latent.candidate;
  const sCount = candidate === "up" ? opts.latent.sTierUp : opts.latent.sTierDown;
  const modelVoters = countModelVoters(candidate, opts.mlProb, opts.mlpProb, opts.gbmProb);

  if (sCount < minS || opts.tierSVotes < minS) return null;
  if (opts.directionalAgreement < minAgree) return null;
  if (modelVoters < minModels) return null;

  const confidence = Number(
    Math.min(
      0.68,
      0.56 +
        opts.directionalAgreement * 0.1 +
        modelVoters * 0.04 +
        (sCount >= 3 ? 0.04 : 0),
    ).toFixed(4),
  );

  const qualityTier: ExpertLeanResult["qualityTier"] =
    modelVoters >= 2 && opts.directionalAgreement >= 0.62 ? "high" : "medium";

  return {
    direction: candidate,
    confidence,
    qualityTier,
    reason: `expert_lean_S${sCount}_models${modelVoters}_agree${opts.directionalAgreement.toFixed(2)}`,
  };
}
