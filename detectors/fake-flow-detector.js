/**
 * Fake Flow Detector - Detects manipulated or fake money flow
 * 
 * Core Strategy: Identify abnormal patterns that suggest manipulation
 * - Low value users: Many users but low total amount
 * - Whale detection: High amount but few users
 * - Volatility: Rapid fluctuations in money flow
 * - Spikes: Sudden large changes
 * 
 * Output: Stability score (0-100) used to adjust other signal confidences
 */

class FakeFlowDetector {
  constructor(config = {}) {
    this.config = {
      lowValueRatio: config.lowValueRatio || 0.5,
      whaleRatio: config.whaleRatio || 2.0,
      volatilityThreshold: config.volatilityThreshold || 0.15,
      spikeThreshold: config.spikeThreshold || 0.10,
      stableThreshold: config.stableThreshold || 70
    };

    this.result = null;
  }

  /**
   * Analyze session and return flow stability result
   * @param {SessionState} session - Current session state
   * @returns {Object} - {stable, score, penalties, adjustmentFactor}
   */
  analyze(session) {
    const { tickHistory, totalUsers, totalAmt } = session;

    if (tickHistory.length < 10) {
      this.result = { stable: true, score: 100, penalties: [], adjustmentFactor: 1.0 };
      return this.result;
    }

    let penalties = [];

    // 1. Check user/amount ratio
    const avgAmountPerUser = totalUsers > 0 ? totalAmt / totalUsers : 0;
    const historicalAvg = this.calculateHistoricalAvgPerUser(tickHistory);

    if (historicalAvg > 0) {
      const ratio = avgAmountPerUser / historicalAvg;

      // Abnormally low amount per user (many fake accounts?)
      if (ratio < this.config.lowValueRatio) {
        penalties.push({
          type: 'low_value_users',
          severity: 0.3,
          reason: 'Abnormally low amount per user detected'
        });
      }

      // Abnormally high amount per user (whale manipulation?)
      if (ratio > this.config.whaleRatio) {
        penalties.push({
          type: 'whale_detected',
          severity: 0.2,
          reason: 'Large whale bets detected'
        });
      }
    }

    // 2. Check for volatile flow (rapid fluctuations)
    const volatility = this.calculateVolatility(tickHistory);

    if (volatility > this.config.volatilityThreshold) {
      penalties.push({
        type: 'unstable_flow',
        severity: 0.4,
        reason: `High volatility detected: ${(volatility * 100).toFixed(1)}% avg change`
      });
    }

    // 3. Check for sudden spikes
    const spikes = this.detectSpikes(tickHistory);

    if (spikes.length > 0) {
      penalties.push({
        type: 'sudden_spikes',
        severity: Math.min(0.2 * spikes.length, 0.5),
        reason: `${spikes.length} sudden spike(s) detected`
      });
    }

    // 4. Calculate stability score
    const totalSeverity = penalties.reduce((sum, p) => sum + p.severity, 0);
    const stabilityScore = Math.max(0, 100 - totalSeverity * 100);

    this.result = {
      stable: stabilityScore >= this.config.stableThreshold,
      score: stabilityScore,
      penalties,
      adjustmentFactor: stabilityScore / 100 // 0-1 multiplier for other signals
    };

    return this.result;
  }

  /**
   * Update detector state with new tick (optional)
   * @param {SessionState} session - Current session state
   */
  onTick(session) {
    // Fake flow detector doesn't need per-tick updates
  }

  /**
   * Reset detector for new session
   */
  reset() {
    this.result = null;
  }

  /**
   * Get current result
   * @returns {Object|null}
   */
  getResult() {
    return this.result;
  }

  /**
   * Get detector statistics
   * @returns {Object}
   */
  getStats() {
    return {
      name: 'fake_flow_detector',
      totalSignals: 0,
      correctPredictions: 0,
      accuracy: 0,
      currentWeight: 0.20,
      lastUpdated: Date.now()
    };
  }

  // ========================================================================
  // Helper Functions
  // ========================================================================

  /**
   * Calculate historical average amount per user
   * @param {Array<TickSnapshot>} tickHistory - Tick history
   * @returns {number} - Average amount per user
   */
  calculateHistoricalAvgPerUser(tickHistory) {
    if (tickHistory.length < 5) return 0;

    const samples = tickHistory.slice(0, Math.min(10, tickHistory.length));
    const avgPerTick = samples.map(t =>
      t.totalUsers > 0 ? t.totalAmt / t.totalUsers : 0
    );

    return avgPerTick.reduce((a, b) => a + b, 0) / avgPerTick.length;
  }

  /**
   * Calculate volatility (average change in taiPct)
   * @param {Array<TickSnapshot>} tickHistory - Tick history
   * @returns {number} - Volatility 0-1
   */
  calculateVolatility(tickHistory) {
    if (tickHistory.length < 5) return 0;

    const ratios = tickHistory.map(t =>
      t.totalAmt > 0 ? t.taiAmt / t.totalAmt : 0.5
    );

    let totalChange = 0;
    for (let i = 1; i < ratios.length; i++) {
      totalChange += Math.abs(ratios[i] - ratios[i - 1]);
    }

    return totalChange / (ratios.length - 1);
  }

  /**
   * Detect sudden spikes in money flow
   * @param {Array<TickSnapshot>} tickHistory - Tick history
   * @returns {Array<Object>} - Detected spikes
   */
  detectSpikes(tickHistory) {
    const spikes = [];

    for (let i = 1; i < tickHistory.length; i++) {
      const prev = tickHistory[i - 1];
      const curr = tickHistory[i];

      const prevRatio = prev.totalAmt > 0 ? prev.taiAmt / prev.totalAmt : 0.5;
      const currRatio = curr.totalAmt > 0 ? curr.taiAmt / curr.totalAmt : 0.5;

      const change = Math.abs(currRatio - prevRatio);

      // Spike = change > 10% in single tick
      if (change > this.config.spikeThreshold) {
        spikes.push({
          subTick: curr.subTick,
          change: change * 100
        });
      }
    }

    return spikes;
  }
}

module.exports = FakeFlowDetector;
