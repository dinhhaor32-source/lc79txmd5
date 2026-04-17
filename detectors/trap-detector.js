/**
 * Trap Detector - Detects when house is "leading" crowd into wrong side
 * 
 * Core Strategy: When money flow is heavily imbalanced (>65% on one side),
 * it's often a trap by the house. Predict the opposite side.
 * 
 * Key Metrics:
 * - Imbalance Ratio: How lopsided is the money flow
 * - Duration: How long has the imbalance been sustained
 * - Stability: How consistent is the imbalance over time
 */

class TrapDetector {
  constructor(config = {}) {
    this.config = {
      imbalanceThreshold: config.imbalanceThreshold || 65,
      minConfidence: config.minConfidence || 30,
      lateTrapPenalty: config.lateTrapPenalty || 0.7,
      durationBonusThreshold: config.durationBonusThreshold || 0.5,
      stabilityHighThreshold: config.stabilityHighThreshold || 0.8,
      stabilityMediumThreshold: config.stabilityMediumThreshold || 0.6
    };

    this.signals = [];
  }

  /**
   * Analyze session and return trap signals
   * @param {SessionState} session - Current session state
   * @returns {Array<Signal>} - Detected signals
   */
  analyze(session) {
    this.signals = [];

    const { taiPct, xiuPct, subTick, tickHistory } = session;

    // 1. Identify imbalance direction
    const imbalanceRatio = Math.max(taiPct, xiuPct);
    const dominantSide = taiPct > xiuPct ? 'TAI' : 'XIU';
    const predictedSide = dominantSide === 'TAI' ? 'XIU' : 'TAI';

    // 2. Check if imbalance is significant
    if (imbalanceRatio < this.config.imbalanceThreshold) {
      return this.signals;
    }

    // 3. Calculate trap strength components
    const magnitude = (imbalanceRatio - 50) / 50; // 0-1 scale

    // Duration: how long has imbalance been >65%?
    const imbalanceStart = this.findImbalanceStart(
      tickHistory,
      this.config.imbalanceThreshold
    );
    const duration = imbalanceStart ? (30 - imbalanceStart) / 30 : 0;

    // Stability: variance of ratio over time
    const stability = this.calculateStability(tickHistory);

    // 4. Calculate confidence
    let confidence = 0;

    // Base confidence from magnitude
    if (imbalanceRatio >= 70) confidence += 30;
    else if (imbalanceRatio >= 65) confidence += 20;

    // Bonus for duration (sustained imbalance is stronger signal)
    if (duration >= this.config.durationBonusThreshold) {
      confidence += 20; // Sustained from subTick 25+
    } else if (duration >= 0.3) {
      confidence += 10;
    }

    // Bonus for stability (consistent imbalance is stronger)
    if (stability >= this.config.stabilityHighThreshold) {
      confidence += 20;
    } else if (stability >= this.config.stabilityMediumThreshold) {
      confidence += 10;
    }

    // Penalty for late trap (appeared after subTick 10)
    if (imbalanceStart && imbalanceStart < 10) {
      confidence *= this.config.lateTrapPenalty; // 30% penalty
    }

    // 5. Create signal if confidence meets threshold
    if (confidence >= this.config.minConfidence) {
      this.signals.push({
        type: `trap_${dominantSide.toLowerCase()}`,
        confidence: Math.min(confidence, 100),
        strength: magnitude,
        reasoning: `${dominantSide} trap detected: ${imbalanceRatio.toFixed(1)}% imbalance sustained for ${(duration * 100).toFixed(0)}% of betting phase`,
        metadata: {
          imbalanceRatio,
          duration,
          stability,
          predictedSide,
          dominantSide,
          imbalanceStart
        },
        timestamp: Date.now()
      });
    }

    return this.signals;
  }

  /**
   * Update detector state with new tick (optional for trap detector)
   * @param {SessionState} session - Current session state
   */
  onTick(session) {
    // Trap detector doesn't need per-tick updates
    // Analysis is done on-demand in analyze()
  }

  /**
   * Reset detector for new session
   */
  reset() {
    this.signals = [];
  }

  /**
   * Get current signals
   * @returns {Array<Signal>}
   */
  getSignals() {
    return this.signals;
  }

  /**
   * Get detector statistics
   * @returns {Object}
   */
  getStats() {
    return {
      name: 'trap_detector',
      totalSignals: 0, // Will be tracked by weight manager
      correctPredictions: 0,
      accuracy: 0,
      currentWeight: 0.35, // Default weight
      lastUpdated: Date.now()
    };
  }

  // ========================================================================
  // Helper Functions
  // ========================================================================

  /**
   * Find first subTick where imbalance exceeded threshold
   * @param {Array<TickSnapshot>} tickHistory - Tick history
   * @param {number} threshold - Imbalance threshold
   * @returns {number|null} - SubTick where imbalance started, or null
   */
  findImbalanceStart(tickHistory, threshold) {
    // Iterate from oldest to newest (reverse order)
    for (let i = tickHistory.length - 1; i >= 0; i--) {
      const tick = tickHistory[i];
      const ratio = Math.max(
        tick.taiAmt / tick.totalAmt * 100,
        tick.xiuAmt / tick.totalAmt * 100
      );

      if (ratio >= threshold) {
        return tick.subTick;
      }
    }

    return null;
  }

  /**
   * Calculate stability of money flow (lower variance = higher stability)
   * @param {Array<TickSnapshot>} tickHistory - Tick history
   * @returns {number} - Stability score 0-1
   */
  calculateStability(tickHistory) {
    if (tickHistory.length < 5) return 0;

    // Calculate taiPct for each tick
    const ratios = tickHistory.map(t =>
      t.totalAmt > 0 ? (t.taiAmt / t.totalAmt * 100) : 50
    );

    // Calculate mean
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;

    // Calculate variance
    const variance = ratios.reduce((sum, r) =>
      sum + Math.pow(r - mean, 2), 0
    ) / ratios.length;

    const stdDev = Math.sqrt(variance);

    // Convert to 0-1 scale (lower stdDev = higher stability)
    // StdDev > 10 = very unstable (0)
    // StdDev < 2 = very stable (1)
    return Math.max(0, Math.min(1, (10 - stdDev) / 8));
  }
}

module.exports = TrapDetector;
