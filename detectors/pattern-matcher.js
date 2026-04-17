/**
 * Pattern Matcher - Matches current session with historical patterns
 * 
 * Core Strategy: Find similar sessions in history and predict based on their outcomes
 * - Pattern similarity: Compare taiPct, imbalance, velocity
 * - Streak analysis: Detect consecutive same results and predict reversal
 * - Win rate: Calculate success rate for similar patterns
 */

class PatternMatcher {
  constructor(config = {}) {
    this.config = {
      similarityTolerance: config.similarityTolerance || 0.1,
      minSimilarSessions: config.minSimilarSessions || 10,
      minWinRate: config.minWinRate || 0.55,
      streakMinLength: config.streakMinLength || 3,
      streakMinReversalRate: config.streakMinReversalRate || 0.55
    };

    this.signals = [];
  }

  /**
   * Analyze session and return pattern signals
   * @param {SessionState} session - Current session state
   * @param {Array<Object>} historicalSessions - Historical session data
   * @returns {Array<Signal>} - Detected signals
   */
  analyze(session, historicalSessions = []) {
    this.signals = [];

    if (historicalSessions.length < this.config.minSimilarSessions) {
      return this.signals;
    }

    // 1. Extract current pattern features
    const currentPattern = this.extractPattern(session);

    // 2. Find similar patterns in history
    const similarSessions = this.findSimilarSessions(
      currentPattern,
      historicalSessions,
      this.config.similarityTolerance
    );

    if (similarSessions.length >= this.config.minSimilarSessions) {
      // 3. Analyze outcomes of similar sessions
      const taiCount = similarSessions.filter(s => s.result === 'TAI').length;
      const xiuCount = similarSessions.length - taiCount;

      const taiRate = taiCount / similarSessions.length;
      const xiuRate = xiuCount / similarSessions.length;

      // 4. Determine prediction (side with higher rate)
      const predictedSide = taiRate > xiuRate ? 'TAI' : 'XIU';
      const winRate = Math.max(taiRate, xiuRate);

      // 5. Calculate confidence
      let confidence = 0;

      // Base confidence from win rate
      if (winRate >= 0.65) confidence += 40;
      else if (winRate >= 0.60) confidence += 30;
      else if (winRate >= 0.55) confidence += 20;
      else return this.signals; // Too weak

      // Bonus for large sample size
      if (similarSessions.length >= 30) confidence += 15;
      else if (similarSessions.length >= 20) confidence += 10;
      else if (similarSessions.length >= 10) confidence += 5;

      // Bonus for high similarity
      const avgSimilarity = similarSessions.reduce((sum, s) =>
        sum + s.similarity, 0
      ) / similarSessions.length;

      if (avgSimilarity >= 0.95) confidence += 15;
      else if (avgSimilarity >= 0.90) confidence += 10;

      // 6. Create pattern signal
      if (confidence >= 30) {
        this.signals.push({
          type: `pattern_${predictedSide.toLowerCase()}`,
          confidence: Math.min(confidence, 100),
          strength: winRate,
          reasoning: `Pattern match: ${similarSessions.length} similar sessions with ${(winRate * 100).toFixed(1)}% ${predictedSide} rate`,
          metadata: {
            similarCount: similarSessions.length,
            winRate,
            avgSimilarity,
            predictedSide
          },
          timestamp: Date.now()
        });
      }
    }

    // 7. Check for streak pattern
    const streakSignal = this.analyzeStreak(historicalSessions);
    if (streakSignal) {
      this.signals.push(streakSignal);
    }

    return this.signals;
  }

  /**
   * Update detector state with new tick (optional for pattern matcher)
   * @param {SessionState} session - Current session state
   */
  onTick(session) {
    // Pattern matcher doesn't need per-tick updates
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
      name: 'pattern_matcher',
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
   * Extract pattern features from session
   * @param {SessionState} session - Current session
   * @returns {Object} - Pattern features
   */
  extractPattern(session) {
    return {
      taiPct: session.taiPct,
      xiuPct: session.xiuPct,
      imbalanceRatio: Math.max(session.taiPct, session.xiuPct),
      velocity: session.velocity
    };
  }

  /**
   * Find similar sessions in history
   * @param {Object} pattern - Current pattern
   * @param {Array<Object>} historicalSessions - Historical sessions
   * @param {number} tolerance - Similarity tolerance
   * @returns {Array<Object>} - Similar sessions with similarity scores
   */
  findSimilarSessions(pattern, historicalSessions, tolerance) {
    return historicalSessions
      .map(session => {
        const similarity = this.calculateSimilarity(pattern, {
          taiPct: session.taiPct,
          xiuPct: session.xiuPct,
          imbalanceRatio: Math.max(session.taiPct, session.xiuPct),
          velocity: { tai: session.velTai, xiu: session.velXiu }
        });

        return { ...session, similarity };
      })
      .filter(s => s.similarity >= (1 - tolerance))
      .sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Calculate similarity between two patterns
   * @param {Object} p1 - Pattern 1
   * @param {Object} p2 - Pattern 2
   * @returns {number} - Similarity 0-1
   */
  calculateSimilarity(p1, p2) {
    // Weighted Euclidean distance
    const weights = {
      taiPct: 0.4,
      imbalanceRatio: 0.3,
      velocity: 0.3
    };

    const taiPctDiff = Math.abs(p1.taiPct - p2.taiPct) / 100;
    const imbalanceDiff = Math.abs(p1.imbalanceRatio - p2.imbalanceRatio) / 100;

    // Velocity comparison (use dominant side)
    const v1 = p1.taiPct > 50 ? (p1.velocity.tai || 50) : (p1.velocity.xiu || 50);
    const v2 = p2.taiPct > 50 ? (p2.velocity.tai || 50) : (p2.velocity.xiu || 50);
    const velDiff = Math.abs(v1 - v2) / 100;

    const distance = Math.sqrt(
      weights.taiPct * Math.pow(taiPctDiff, 2) +
      weights.imbalanceRatio * Math.pow(imbalanceDiff, 2) +
      weights.velocity * Math.pow(velDiff, 2)
    );

    // Convert distance to similarity (0-1)
    return Math.max(0, 1 - distance);
  }

  /**
   * Analyze streak patterns
   * @param {Array<Object>} historicalSessions - Historical sessions
   * @returns {Signal|null} - Streak signal or null
   */
  analyzeStreak(historicalSessions) {
    // Check if we're in a streak
    if (historicalSessions.length < 5) return null;

    const recent = historicalSessions.slice(0, 5);

    // Check for streak of 3, 4, or 5
    for (let len = 3; len <= 5; len++) {
      const streak = recent.slice(0, len);
      if (streak.every(s => s.result === streak[0].result)) {
        // Found a streak! Analyze reversal rate
        const reversalRate = this.calculateReversalRate(
          historicalSessions,
          len,
          streak[0].result
        );

        if (reversalRate >= this.config.streakMinReversalRate) {
          const predictedSide = streak[0].result === 'TAI' ? 'XIU' : 'TAI';

          return {
            type: `pattern_${predictedSide.toLowerCase()}`,
            confidence: Math.min(30 + (reversalRate - 0.55) * 100, 70),
            strength: reversalRate,
            reasoning: `Streak reversal: ${len}x ${streak[0].result} with ${(reversalRate * 100).toFixed(1)}% historical reversal rate`,
            metadata: {
              streakLength: len,
              streakSide: streak[0].result,
              reversalRate,
              predictedSide
            },
            timestamp: Date.now()
          };
        }

        break; // Only check longest streak
      }
    }

    return null;
  }

  /**
   * Calculate reversal rate after a streak
   * @param {Array<Object>} sessions - Historical sessions
   * @param {number} streakLength - Length of streak
   * @param {string} streakSide - 'TAI' or 'XIU'
   * @returns {number} - Reversal rate 0-1
   */
  calculateReversalRate(sessions, streakLength, streakSide) {
    let streakCount = 0;
    let reversalCount = 0;

    for (let i = streakLength; i < sessions.length; i++) {
      const prev = sessions.slice(i - streakLength, i);
      if (prev.every(s => s.result === streakSide)) {
        streakCount++;
        const oppositeSide = streakSide === 'TAI' ? 'XIU' : 'TAI';
        if (sessions[i].result === oppositeSide) {
          reversalCount++;
        }
      }
    }

    return streakCount > 0 ? reversalCount / streakCount : 0;
  }
}

module.exports = PatternMatcher;
