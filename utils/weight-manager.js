/**
 * Weight Manager - Dynamically adjusts detector weights based on performance
 * 
 * Core Strategy: Track accuracy of each detector and adjust weights
 * - High accuracy (>60%): Increase weight
 * - Low accuracy (<45%): Decrease weight
 * - Weights bounded: 0.1 (min) to 0.5 (max)
 * - Weights normalized: Sum to 1.0
 */

const fs = require('fs');
const path = require('path');

class WeightManager {
  constructor(config = {}) {
    this.config = {
      minSamples: config.minSamples || 50,
      minWeight: config.minWeight || 0.1,
      maxWeight: config.maxWeight || 0.5,
      updateFrequency: config.updateFrequency || 10
    };

    // Default weights
    this.weights = {
      trap: 0.35,
      panic: 0.25,
      pattern: 0.20
    };

    // Detector statistics
    this.stats = {
      trap: { totalSignals: 0, correctPredictions: 0, accuracy: 0 },
      panic: { totalSignals: 0, correctPredictions: 0, accuracy: 0 },
      pattern: { totalSignals: 0, correctPredictions: 0, accuracy: 0 }
    };

    this.sessionCount = 0;

    // Load saved stats if available
    this.loadStats();
  }

  /**
   * Record result for a prediction
   * @param {Array<Signal>} signals - Signals used in prediction
   * @param {boolean} correct - Was prediction correct
   */
  recordResult(signals, correct) {
    if (!signals || signals.length === 0) return;

    // Update stats for each signal type
    signals.forEach(signal => {
      const type = signal.type.split('_')[0]; // 'trap', 'panic', 'pattern'

      if (this.stats[type]) {
        this.stats[type].totalSignals++;
        if (correct) {
          this.stats[type].correctPredictions++;
        }

        // Update accuracy
        this.stats[type].accuracy =
          this.stats[type].correctPredictions / this.stats[type].totalSignals;
      }
    });

    this.sessionCount++;
  }

  /**
   * Update weights based on detector performance
   */
  updateWeights() {
    console.log('[WEIGHTS] Updating detector weights...');

    Object.keys(this.stats).forEach(detectorName => {
      const stats = this.stats[detectorName];

      if (stats.totalSignals < this.config.minSamples) {
        // Not enough data, keep default weight
        return;
      }

      const accuracy = stats.accuracy;
      let newWeight = this.weights[detectorName];

      // Adjust weight based on accuracy
      if (accuracy >= 0.65) {
        // Excellent performance: increase weight by 20%
        newWeight *= 1.2;
      } else if (accuracy >= 0.60) {
        // Good performance: increase weight by 10%
        newWeight *= 1.1;
      } else if (accuracy >= 0.55) {
        // Acceptable performance: keep weight
        newWeight *= 1.0;
      } else if (accuracy >= 0.50) {
        // Below average: decrease weight by 10%
        newWeight *= 0.9;
      } else if (accuracy >= 0.45) {
        // Poor performance: decrease weight by 25%
        newWeight *= 0.75;
      } else {
        // Very poor: decrease weight by 50%
        newWeight *= 0.5;
      }

      // Ensure weights stay within bounds
      newWeight = Math.max(this.config.minWeight, Math.min(this.config.maxWeight, newWeight));

      this.weights[detectorName] = newWeight;

      console.log(`[WEIGHTS] ${detectorName}: ${(accuracy * 100).toFixed(1)}% accuracy → weight ${newWeight.toFixed(2)}`);
    });

    // Normalize weights to sum to 1.0
    this.normalizeWeights();

    // Save stats
    this.saveStats();
  }

  /**
   * Normalize weights to sum to 1.0
   */
  normalizeWeights() {
    const total = Object.values(this.weights).reduce((sum, w) => sum + w, 0);

    Object.keys(this.weights).forEach(key => {
      this.weights[key] = this.weights[key] / total;
    });
  }

  /**
   * Get current weights
   * @returns {Object} - {trap: number, panic: number, pattern: number}
   */
  getWeights() {
    return { ...this.weights };
  }

  /**
   * Get detector statistics
   * @returns {Object}
   */
  getStats() {
    const result = {};

    Object.keys(this.stats).forEach(detectorName => {
      const stats = this.stats[detectorName];
      result[detectorName] = {
        accuracy: stats.totalSignals > 0
          ? parseFloat((stats.accuracy * 100).toFixed(1))
          : 0,
        weight: parseFloat(this.weights[detectorName].toFixed(2)),
        signals: stats.totalSignals
      };
    });

    return result;
  }

  /**
   * Check if weights should be updated
   * @returns {boolean}
   */
  shouldUpdate() {
    return this.sessionCount % this.config.updateFrequency === 0;
  }

  // ========================================================================
  // Persistence
  // ========================================================================

  /**
   * Save stats to file
   */
  saveStats() {
    const STATS_FILE = path.join(__dirname, '..', 'detector_stats.json');

    const data = {
      weights: this.weights,
      stats: this.stats,
      sessionCount: this.sessionCount,
      lastUpdated: new Date().toISOString()
    };

    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[WEIGHTS] Error saving stats:', err.message);
    }
  }

  /**
   * Load stats from file
   */
  loadStats() {
    const STATS_FILE = path.join(__dirname, '..', 'detector_stats.json');

    if (!fs.existsSync(STATS_FILE)) return;

    try {
      const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));

      if (data.weights) this.weights = data.weights;
      if (data.stats) this.stats = data.stats;
      if (data.sessionCount) this.sessionCount = data.sessionCount;

      console.log('[WEIGHTS] Loaded saved detector stats');
    } catch (err) {
      console.error('[WEIGHTS] Error loading stats:', err.message);
    }
  }
}

module.exports = WeightManager;
