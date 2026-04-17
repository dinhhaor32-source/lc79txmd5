/**
 * Signal Aggregator - Combines signals from multiple detectors
 * 
 * Core Strategy: Weighted voting with conflict resolution
 * - Each detector has a weight (trap: 35%, panic: 25%, pattern: 20%)
 * - Signals for same side are combined
 * - Conflicting signals reduce confidence
 * - Minimum confidence threshold: 40%
 */

class SignalAggregator {
  constructor(config = {}) {
    this.config = {
      minConfidenceThreshold: config.minConfidenceThreshold || 40,
      agreementBonus: config.agreementBonus || 1.2,
      maxConflictPenalty: config.maxConflictPenalty || 0.3
    };
  }

  /**
   * Aggregate signals into final prediction
   * @param {Array<Signal>} signals - All signals from detectors
   * @param {Object} fakeFlowResult - Fake flow detection result
   * @param {Object} weights - Detector weights {trap: 0.35, panic: 0.25, pattern: 0.20}
   * @returns {Object} - {prediction, confidence, reasoning, signals, scores}
   */
  aggregate(signals, fakeFlowResult, weights = {}) {
    if (signals.length === 0) {
      return {
        prediction: null,
        confidence: 0,
        reasoning: 'No signals detected',
        signals: [],
        scores: { tai: 0, xiu: 0 }
      };
    }

    // Default weights
    const defaultWeights = {
      trap: 0.35,
      panic: 0.25,
      pattern: 0.20
    };
    const finalWeights = { ...defaultWeights, ...weights };

    // 1. Apply fake flow adjustment to all signals
    const adjustmentFactor = fakeFlowResult?.adjustmentFactor || 1.0;
    const adjustedSignals = signals.map(s => ({
      ...s,
      adjustedConfidence: s.confidence * adjustmentFactor
    }));

    // 2. Group signals by predicted side
    const taiSignals = adjustedSignals.filter(s =>
      this.getSignalPrediction(s) === 'TAI'
    );
    const xiuSignals = adjustedSignals.filter(s =>
      this.getSignalPrediction(s) === 'XIU'
    );

    // 3. Calculate weighted scores for each side
    const taiScore = this.calculateWeightedScore(taiSignals, finalWeights);
    const xiuScore = this.calculateWeightedScore(xiuSignals, finalWeights);

    // 4. Determine prediction
    if (taiScore === 0 && xiuScore === 0) {
      return {
        prediction: null,
        confidence: 0,
        reasoning: 'All signals below threshold after adjustment',
        signals: adjustedSignals,
        scores: { tai: 0, xiu: 0 }
      };
    }

    const predictedSide = taiScore > xiuScore ? 'TAI' : 'XIU';
    const winningScore = Math.max(taiScore, xiuScore);
    const losingScore = Math.min(taiScore, xiuScore);

    // 5. Calculate final confidence
    let confidence = winningScore;

    // Bonus for signal agreement (no conflicting signals)
    if (losingScore === 0) {
      confidence *= this.config.agreementBonus; // 20% bonus
    } else {
      // Penalty for conflicting signals
      const conflictRatio = losingScore / winningScore;
      confidence *= (1 - conflictRatio * this.config.maxConflictPenalty); // Up to 30% penalty
    }

    // Apply flow stability adjustment
    confidence *= adjustmentFactor;

    // Cap at 100
    confidence = Math.min(confidence, 100);

    // 6. Check minimum confidence threshold
    if (confidence < this.config.minConfidenceThreshold) {
      return {
        prediction: null,
        confidence,
        reasoning: `Confidence below minimum threshold (${this.config.minConfidenceThreshold}%)`,
        signals: adjustedSignals,
        scores: { tai: taiScore, xiu: xiuScore }
      };
    }

    // 7. Build reasoning
    const supportingSignals = adjustedSignals.filter(s =>
      this.getSignalPrediction(s) === predictedSide
    );
    const reasoning = this.buildReasoning(
      predictedSide,
      supportingSignals,
      fakeFlowResult
    );

    return {
      prediction: predictedSide,
      confidence: Math.round(confidence),
      reasoning,
      signals: adjustedSignals,
      scores: { tai: taiScore, xiu: xiuScore },
      flowStability: fakeFlowResult?.score || 100
    };
  }

  // ========================================================================
  // Helper Functions
  // ========================================================================

  /**
   * Get predicted side from signal
   * @param {Signal} signal - Signal object
   * @returns {string} - 'TAI' or 'XIU'
   */
  getSignalPrediction(signal) {
    // Trap and panic signals predict opposite side
    if (signal.type.includes('trap_tai') || signal.type.includes('panic_tai')) {
      return 'XIU';
    }
    if (signal.type.includes('trap_xiu') || signal.type.includes('panic_xiu')) {
      return 'TAI';
    }

    // Pattern signals have predictedSide in metadata
    if (signal.metadata?.predictedSide) {
      return signal.metadata.predictedSide;
    }

    // Default: extract from signal type
    if (signal.type.includes('tai')) return 'TAI';
    if (signal.type.includes('xiu')) return 'XIU';

    return 'TAI'; // Fallback
  }

  /**
   * Calculate weighted score for a group of signals
   * @param {Array<Signal>} signals - Signals for one side
   * @param {Object} weights - Detector weights
   * @returns {number} - Weighted score
   */
  calculateWeightedScore(signals, weights) {
    let totalScore = 0;

    signals.forEach(signal => {
      const type = signal.type.split('_')[0]; // 'trap', 'panic', 'pattern'
      const weight = weights[type] || 0.20;

      // Weighted contribution
      totalScore += signal.adjustedConfidence * weight;
    });

    return totalScore;
  }

  /**
   * Build human-readable reasoning
   * @param {string} predictedSide - 'TAI' or 'XIU'
   * @param {Array<Signal>} supportingSignals - Signals supporting prediction
   * @param {Object} fakeFlowResult - Fake flow result
   * @returns {string} - Reasoning text
   */
  buildReasoning(predictedSide, supportingSignals, fakeFlowResult) {
    const parts = [];

    // Group signals by type
    const trapSignals = supportingSignals.filter(s => s.type.includes('trap'));
    const panicSignals = supportingSignals.filter(s => s.type.includes('panic'));
    const patternSignals = supportingSignals.filter(s => s.type.includes('pattern'));

    // Add trap reasoning
    if (trapSignals.length > 0) {
      const trap = trapSignals[0];
      const oppositeSide = predictedSide === 'TAI' ? 'XIU' : 'TAI';
      parts.push(`${oppositeSide} trap detected (${trap.metadata.imbalanceRatio.toFixed(1)}% imbalance)`);
    }

    // Add panic reasoning
    if (panicSignals.length > 0) {
      const panic = panicSignals[0];
      const oppositeSide = predictedSide === 'TAI' ? 'XIU' : 'TAI';
      parts.push(`Panic betting on ${oppositeSide} (${panic.metadata.velocity.toFixed(1)}% velocity)`);
    }

    // Add pattern reasoning
    if (patternSignals.length > 0) {
      const pattern = patternSignals[0];
      if (pattern.metadata.streakLength) {
        parts.push(`Streak reversal pattern (${pattern.metadata.streakLength}x ${pattern.metadata.streakSide})`);
      } else if (pattern.metadata.similarCount) {
        parts.push(`Historical pattern match (${pattern.metadata.similarCount} similar sessions)`);
      }
    }

    // Add flow stability note
    if (fakeFlowResult && fakeFlowResult.score < 70) {
      parts.push(`⚠️ Unstable flow detected (${fakeFlowResult.score.toFixed(0)}% stability)`);
    }

    return parts.join(' + ');
  }
}

module.exports = SignalAggregator;
