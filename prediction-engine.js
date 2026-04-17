/**
 * Prediction Engine - Main module for House Psychology Prediction Algorithm
 * 
 * Analyzes real-time betting data to predict Tai/Xiu outcomes based on:
 * - Trap Detection: House leading crowd into wrong side
 * - Panic Betting: Crowd rushing in late phase
 * - Historical Patterns: Similar session outcomes
 * - Fake Flow Detection: Manipulated money flow
 */

// ============================================================================
// Error Classes
// ============================================================================

class DataQualityError extends Error {
  constructor(message, context) {
    super(message);
    this.name = 'DataQualityError';
    this.context = context;
  }
}

class CalculationError extends Error {
  constructor(message, detector, context) {
    super(message);
    this.name = 'CalculationError';
    this.detector = detector;
    this.context = context;
  }
}

class StorageError extends Error {
  constructor(message, operation, data) {
    super(message);
    this.name = 'StorageError';
    this.operation = operation;
    this.data = data;
  }
}

// ============================================================================
// Data Structures
// ============================================================================

/**
 * SessionState - Current session state with all metrics
 * @typedef {Object} SessionState
 * @property {number} id - Session ID
 * @property {string} md5 - Session MD5
 * @property {string} state - BETTING | WAITING | RESULT
 * @property {number} tick - Current tick
 * @property {number} subTick - SubTick countdown (30 -> 0)
 * @property {number} taiAmt - TAI amount
 * @property {number} xiuAmt - XIU amount
 * @property {number} totalAmt - Total amount
 * @property {number} taiPct - TAI percentage
 * @property {number} xiuPct - XIU percentage
 * @property {number} taiUsers - TAI users count
 * @property {number} xiuUsers - XIU users count
 * @property {number} totalUsers - Total users
 * @property {Array<TickSnapshot>} tickHistory - Tick history
 * @property {number} imbalanceRatio - Max(taiPct, xiuPct)
 * @property {Object} velocity - {tai: number, xiu: number}
 * @property {number} startTime - Session start timestamp
 * @property {number} lastUpdate - Last update timestamp
 */

/**
 * TickSnapshot - Snapshot of tick data
 * @typedef {Object} TickSnapshot
 * @property {number} subTick - SubTick value
 * @property {number} taiAmt - TAI amount
 * @property {number} xiuAmt - XIU amount
 * @property {number} totalAmt - Total amount
 * @property {number} taiUsers - TAI users
 * @property {number} xiuUsers - XIU users
 * @property {number} totalUsers - Total users
 * @property {number} timestamp - Timestamp
 */

/**
 * Signal - Detection signal from a detector
 * @typedef {Object} Signal
 * @property {string} type - Signal type (trap_tai, panic_xiu, etc.)
 * @property {number} confidence - Confidence 0-100
 * @property {number} strength - Signal strength 0-1
 * @property {string} reasoning - Human-readable explanation
 * @property {Object} metadata - Signal-specific data
 * @property {number} timestamp - Signal timestamp
 */

/**
 * Prediction - Final prediction result
 * @typedef {Object} Prediction
 * @property {number} sessionId - Session ID
 * @property {string|null} prediction - 'TAI' | 'XIU' | null
 * @property {number} confidence - Confidence 0-100
 * @property {Array<Signal>} signals - All signals used
 * @property {string} reasoning - Aggregated reasoning
 * @property {number} lockTime - SubTick when prediction was locked
 * @property {string} timestamp - ISO timestamp
 */

// ============================================================================
// Prediction Engine Class
// ============================================================================

class PredictionEngine {
  constructor() {
    // Import detectors and aggregator
    const TrapDetector = require('./detectors/trap-detector');
    const PanicDetector = require('./detectors/panic-detector');
    const PatternMatcher = require('./detectors/pattern-matcher');
    const SignalAggregator = require('./utils/signal-aggregator');

    this.currentSession = null;
    this.detectors = {
      trap: new TrapDetector(),
      panic: new PanicDetector(),
      pattern: new PatternMatcher(),
      fakeFlow: null  // Will be added in Phase 3
    };
    this.aggregator = new SignalAggregator();
    this.weightManager = null;  // Will be added in Phase 3
    this.predictionHistory = [];
    this.currentPrediction = null;
  }

  /**
   * Start a new session
   * @param {number} id - Session ID
   * @param {string} md5 - Session MD5
   */
  startSession(id, md5) {
    this.currentSession = {
      id,
      md5,
      state: 'BETTING',
      tick: 0,
      subTick: 30,
      taiAmt: 0,
      xiuAmt: 0,
      totalAmt: 0,
      taiPct: 50,
      xiuPct: 50,
      taiUsers: 0,
      xiuUsers: 0,
      totalUsers: 0,
      tickHistory: [],
      imbalanceRatio: 50,
      velocity: { tai: 50, xiu: 50 },
      startTime: Date.now(),
      lastUpdate: Date.now()
    };

    // Reset all detectors
    if (this.detectors.trap) this.detectors.trap.reset();
    if (this.detectors.panic) this.detectors.panic.reset();
    if (this.detectors.pattern) this.detectors.pattern.reset();
    if (this.detectors.fakeFlow) this.detectors.fakeFlow.reset();

    this.currentPrediction = null;

    console.log(`[PREDICTION] Started session #${id}`);
  }

  /**
   * Process incoming tick data
   * @param {Object} tickData - Raw tick data from WebSocket
   */
  processTick(tickData) {
    if (!this.currentSession || tickData.id !== this.currentSession.id) {
      return;
    }

    try {
      // Update session state
      this.updateSessionState(tickData);

      // Update detectors
      if (this.detectors.trap) this.detectors.trap.onTick(this.currentSession);
      if (this.detectors.panic) this.detectors.panic.onTick(this.currentSession);
      if (this.detectors.pattern) this.detectors.pattern.onTick(this.currentSession);
      if (this.detectors.fakeFlow) this.detectors.fakeFlow.onTick(this.currentSession);

      // Generate prediction if in decision window (subTick 15-3)
      if (tickData.subTick <= 15 && tickData.subTick >= 3) {
        this.generatePrediction();
      }
    } catch (err) {
      console.error('[PREDICTION] Error processing tick:', err);
    }
  }

  /**
   * Update session state with new tick data
   * @param {Object} tickData - Raw tick data
   */
  updateSessionState(tickData) {
    const { data, subTick, tick, state } = tickData;

    // Calculate percentages
    const totalAmt = data.totalAmount || 0;
    const taiAmt = data.totalAmountPerType?.TAI || 0;
    const xiuAmt = data.totalAmountPerType?.XIU || 0;
    const taiPct = totalAmt > 0 ? (taiAmt / totalAmt * 100) : 50;
    const xiuPct = 100 - taiPct;

    // Update current session
    Object.assign(this.currentSession, {
      tick,
      subTick,
      state,
      taiAmt,
      xiuAmt,
      totalAmt,
      taiPct,
      xiuPct,
      taiUsers: data.totalUsersPerType?.TAI || 0,
      xiuUsers: data.totalUsersPerType?.XIU || 0,
      totalUsers: data.totalUniqueUsers || 0,
      imbalanceRatio: Math.max(taiPct, xiuPct),
      lastUpdate: Date.now()
    });

    // Add to tick history
    this.currentSession.tickHistory.unshift({
      subTick,
      taiAmt,
      xiuAmt,
      totalAmt,
      taiUsers: this.currentSession.taiUsers,
      xiuUsers: this.currentSession.xiuUsers,
      totalUsers: this.currentSession.totalUsers,
      timestamp: Date.now()
    });

    // Keep only last 50 ticks
    if (this.currentSession.tickHistory.length > 50) {
      this.currentSession.tickHistory.pop();
    }

    // Calculate velocity
    this.currentSession.velocity = this.calculateVelocity();
  }

  /**
   * Calculate velocity (money flow speed)
   * @returns {Object} {tai: number, xiu: number}
   */
  calculateVelocity() {
    const history = this.currentSession.tickHistory;
    if (history.length < 10) return { tai: 50, xiu: 50 };

    const snap20 = history.find(t => t.subTick <= 20 && t.subTick >= 18);
    const snap5 = history.find(t => t.subTick <= 5);

    if (!snap20 || !snap5) return { tai: 50, xiu: 50 };

    const deltaTotal = snap5.totalAmt - snap20.totalAmt;
    if (deltaTotal <= 0) return { tai: 50, xiu: 50 };

    return {
      tai: ((snap5.taiAmt - snap20.taiAmt) / deltaTotal) * 100,
      xiu: ((snap5.xiuAmt - snap20.xiuAmt) / deltaTotal) * 100
    };
  }

  /**
   * Generate prediction from all detectors
   */
  generatePrediction() {
    try {
      // Collect signals from all detectors
      const signals = [];

      // Trap detector
      signals.push(...this.detectors.trap.analyze(this.currentSession));

      // Panic detector
      signals.push(...this.detectors.panic.analyze(this.currentSession));

      // Pattern matcher - needs historical data
      if (this.detectors.pattern) {
        try {
          const { getHistoricalSessions } = require('./data-collector');
          const history = getHistoricalSessions(200);
          signals.push(...this.detectors.pattern.analyze(this.currentSession, history));
        } catch (err) {
          console.error('[PREDICTION] Error in pattern matcher:', err.message);
        }
      }

      // Fake flow detector (Phase 3)
      const fakeFlowResult = this.detectors.fakeFlow
        ? this.detectors.fakeFlow.analyze(this.currentSession)
        : { adjustmentFactor: 1.0, score: 100, stable: true, penalties: [] };

      // Get weights (Phase 3 will use dynamic weights)
      const weights = this.weightManager
        ? this.weightManager.getWeights()
        : { trap: 0.35, panic: 0.25, pattern: 0.20 };

      // Aggregate signals
      const prediction = this.aggregator.aggregate(
        signals,
        fakeFlowResult,
        weights
      );

      // Store current prediction
      this.currentPrediction = {
        ...prediction,
        sessionId: this.currentSession.id,
        lockTime: this.currentSession.subTick,
        timestamp: new Date().toISOString()
      };

    } catch (err) {
      console.error('[PREDICTION] Error generating prediction:', err);
      this.currentPrediction = {
        sessionId: this.currentSession.id,
        prediction: null,
        confidence: 0,
        reasoning: 'Error: ' + err.message,
        signals: [],
        lockTime: this.currentSession.subTick,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Record session result and update statistics
   * @param {Object} resultEntry - Result data
   */
  recordResult(resultEntry) {
    if (!this.currentSession || !this.currentPrediction) return;

    const prediction = this.currentPrediction;
    const correct = prediction.prediction === resultEntry.result;

    // Save to history
    const record = {
      sessionId: this.currentSession.id,
      predicted: prediction.prediction,
      result: resultEntry.result,
      correct,
      confidence: prediction.confidence,
      signals: prediction.signals?.map(s => s.type) || [],
      reasoning: prediction.reasoning,
      lockTime: prediction.lockTime,
      timestamp: prediction.timestamp
    };

    this.predictionHistory.unshift(record);
    if (this.predictionHistory.length > 100) {
      this.predictionHistory.pop();
    }

    // Save to file
    try {
      const { savePrediction } = require('./data-collector');
      savePrediction(record);
    } catch (err) {
      console.error('[PREDICTION] Error saving prediction:', err.message);
    }

    console.log(`[PREDICTION] #${this.currentSession.id} | Predicted: ${prediction.prediction} | Result: ${resultEntry.result} | ${correct ? '✓' : '✗'} | Confidence: ${prediction.confidence}%`);
  }

  /**
   * Get current prediction
   * @returns {Prediction|null}
   */
  getCurrentPrediction() {
    return this.currentPrediction;
  }

  /**
   * Get prediction history
   * @param {number} limit - Max number of predictions
   * @param {number} minConfidence - Minimum confidence filter
   * @returns {Array<Object>}
   */
  getPredictionHistory(limit = 30, minConfidence = 0) {
    return this.predictionHistory
      .filter(p => p.confidence >= minConfidence)
      .slice(0, limit);
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const history = this.predictionHistory;
    if (history.length === 0) {
      return {
        overall: { totalPredictions: 0, correctPredictions: 0, accuracy: 0 },
        byConfidence: {},
        byDetector: {},
        recentTrend: {}
      };
    }

    const correct = history.filter(p => p.correct).length;
    const accuracy = (correct / history.length * 100).toFixed(1);

    return {
      overall: {
        totalPredictions: history.length,
        correctPredictions: correct,
        accuracy: parseFloat(accuracy),
        lastUpdated: new Date().toISOString()
      },
      byConfidence: {
        high: this.calculateAccuracyForRange(history, 70, 100),
        medium: this.calculateAccuracyForRange(history, 50, 69),
        low: this.calculateAccuracyForRange(history, 40, 49)
      },
      byDetector: {},
      recentTrend: {
        last10: this.calculateAccuracyForLast(history, 10),
        last20: this.calculateAccuracyForLast(history, 20),
        last50: this.calculateAccuracyForLast(history, 50)
      }
    };
  }

  /**
   * Get current signals from all detectors
   * @returns {Object|null}
   */
  getCurrentSignals() {
    if (!this.currentSession) return null;

    return {
      trap: this.detectors.trap ? this.detectors.trap.getSignals() : [],
      panic: this.detectors.panic ? this.detectors.panic.getSignals() : [],
      pattern: this.detectors.pattern ? this.detectors.pattern.getSignals() : [],
      fakeFlow: this.detectors.fakeFlow ? this.detectors.fakeFlow.getResult() : null
    };
  }

  /**
   * Get debug info for a session
   * @param {number} sessionId - Session ID
   * @returns {Object|null}
   */
  getDebugInfo(sessionId) {
    // Find prediction in history
    const prediction = this.predictionHistory.find(p => p.sessionId === sessionId);

    if (!prediction) return null;

    return {
      session: {
        id: sessionId,
        result: prediction.result,
        predicted: prediction.predicted,
        correct: prediction.correct
      },
      prediction
    };
  }

  calculateAccuracyForRange(history, min, max) {
    const filtered = history.filter(p => p.confidence >= min && p.confidence <= max);
    if (filtered.length === 0) return { range: `${min}-${max}`, accuracy: 0, count: 0 };

    const correct = filtered.filter(p => p.correct).length;
    return {
      range: `${min}-${max}`,
      accuracy: parseFloat((correct / filtered.length * 100).toFixed(1)),
      count: filtered.length
    };
  }

  calculateAccuracyForLast(history, n) {
    const recent = history.slice(0, Math.min(n, history.length));
    if (recent.length === 0) return 0;

    const correct = recent.filter(p => p.correct).length;
    return parseFloat((correct / recent.length * 100).toFixed(1));
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance = null;

function getPredictionEngine() {
  if (!instance) {
    instance = new PredictionEngine();
  }
  return instance;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  PredictionEngine,
  getPredictionEngine,
  DataQualityError,
  CalculationError,
  StorageError
};
