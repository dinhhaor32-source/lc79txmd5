/**
 * Panic Detector - Detects when crowd rushes in late phase
 * 
 * Core Strategy: When money flows rapidly into one side in late phase (subTick <= 15),
 * it's often panic betting. Predict the opposite side (contrarian strategy).
 * 
 * Key Metrics:
 * - Velocity: % of late-phase money flow going to each side
 * - Acceleration: Is velocity increasing over time
 * - Timing: How late in the phase is the panic occurring
 */

class PanicDetector {
  constructor(config = {}) {
    this.config = {
      velocityThreshold: config.velocityThreshold || 70,
      latePhaseStart: config.latePhaseStart || 15,
      veryLatePhase: config.veryLatePhase || 5,
      minConfidence: config.minConfidence || 30,
      accelerationThreshold: config.accelerationThreshold || 0.5
    };

    this.signals = [];
  }

  /**
   * Analyze session and return panic signals
   * @param {SessionState} session - Current session state
   * @returns {Array<Signal>} - Detected signals
   */
  analyze(session) {
    this.signals = [];

    const { subTick, tickHistory } = session;

    // Only analyze in late phase (subTick <= 15)
    if (subTick > this.config.latePhaseStart) {
      return this.signals;
    }

    // 1. Calculate velocity for both sides
    const velocity = this.calculateVelocity(tickHistory);

    if (!velocity) {
      return this.signals;
    }

    // 2. Detect panic for each side
    ['tai', 'xiu'].forEach(side => {
      const vel = velocity[side];
      const oppositeSide = side === 'tai' ? 'xiu' : 'tai';

      // Panic threshold: >70% of late-phase money flow
      if (vel < this.config.velocityThreshold) return;

      // 3. Calculate panic intensity
      const intensity = (vel - 50) / 50; // 0-1 scale

      // 4. Calculate confidence
      let confidence = 0;

      // Base confidence from velocity
      if (vel >= 80) confidence += 40;
      else if (vel >= 70) confidence += 30;

      // Bonus for very late panic (subTick <= 5)
      if (subTick <= this.config.veryLatePhase) {
        confidence += 20;
      } else if (subTick <= 10) {
        confidence += 10;
      }

      // Bonus for acceleration (velocity increasing)
      const acceleration = this.calculateAcceleration(tickHistory, side);
      if (acceleration > this.config.accelerationThreshold) {
        confidence += 15;
      }

      // 5. Create signal (predict opposite side)
      if (confidence >= this.config.minConfidence) {
        this.signals.push({
          type: `panic_${side}`,
          confidence: Math.min(confidence, 100),
          strength: intensity,
          reasoning: `Panic betting on ${side.toUpperCase()}: ${vel.toFixed(1)}% of late-phase flow at subTick ${subTick}`,
          metadata: {
            velocity: vel,
            acceleration,
            timing: subTick,
            predictedSide: oppositeSide.toUpperCase(),
            panicSide: side.toUpperCase()
          },
          timestamp: Date.now()
        });
      }
    });

    return this.signals;
  }

  /**
   * Update detector state with new tick (optional for panic detector)
   * @param {SessionState} session - Current session state
   */
  onTick(session) {
    // Panic detector doesn't need per-tick updates
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
      name: 'panic_detector',
      totalSignals: 0, // Will be tracked by weight manager
      correctPredictions: 0,
      accuracy: 0,
      currentWeight: 0.25, // Default weight
      lastUpdated: Date.now()
    };
  }

  // ========================================================================
  // Helper Functions
  // ========================================================================

  /**
   * Calculate velocity (money flow speed) between subTick 20 and subTick 5
   * @param {Array<TickSnapshot>} tickHistory - Tick history
   * @returns {Object|null} - {tai: number, xiu: number} or null
   */
  calculateVelocity(tickHistory) {
    // Compare money flow between subTick 20 and subTick 5
    const snap20 = tickHistory.find(t => t.subTick <= 20 && t.subTick >= 18);
    const snap5 = tickHistory.find(t => t.subTick <= 5);

    if (!snap20 || !snap5) return null;

    const deltaTotal = snap5.totalAmt - snap20.totalAmt;
    if (deltaTotal <= 0) return null;

    const deltaTai = snap5.taiAmt - snap20.taiAmt;
    const deltaXiu = snap5.xiuAmt - snap20.xiuAmt;

    return {
      tai: (deltaTai / deltaTotal) * 100,
      xiu: (deltaXiu / deltaTotal) * 100
    };
  }

  /**
   * Calculate acceleration (velocity change over time)
   * @param {Array<TickSnapshot>} tickHistory - Tick history
   * @param {string} side - 'tai' or 'xiu'
   * @returns {number} - Acceleration as % change
   */
  calculateAcceleration(tickHistory, side) {
    // Compare velocity in last 10 ticks vs previous 10 ticks
    if (tickHistory.length < 20) return 0;

    const recent = tickHistory.slice(0, 10);
    const previous = tickHistory.slice(10, 20);

    const recentVel = this.calculateSegmentVelocity(recent, side);
    const prevVel = this.calculateSegmentVelocity(previous, side);

    if (prevVel === 0) return 0;

    return (recentVel - prevVel) / prevVel; // % change
  }

  /**
   * Calculate velocity for a segment of ticks
   * @param {Array<TickSnapshot>} segment - Tick segment
   * @param {string} side - 'tai' or 'xiu'
   * @returns {number} - Velocity %
   */
  calculateSegmentVelocity(segment, side) {
    if (segment.length < 2) return 0;

    const first = segment[segment.length - 1];
    const last = segment[0];

    const deltaTotal = last.totalAmt - first.totalAmt;
    if (deltaTotal <= 0) return 0;

    const key = side === 'tai' ? 'taiAmt' : 'xiuAmt';
    const delta = last[key] - first[key];

    return (delta / deltaTotal) * 100;
  }
}

module.exports = PanicDetector;
