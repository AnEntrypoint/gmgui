class KalmanFilter {
  constructor(config = {}) {
    this._initEst = config.initialEstimate || 0;
    this._initErr = config.initialError || 1000;
    this._q = Math.max(config.processNoise || 1, 0.001);
    this._r = config.measurementNoise || 10;
    this._est = this._initEst;
    this._err = this._initErr;
    this._gain = 0;
    this._initialized = false;
    this._lastValid = this._initEst;
  }

  update(measurement) {
    if (!Number.isFinite(measurement)) {
      return { estimate: this._est, error: this._err, gain: this._gain };
    }
    if (measurement < 0) measurement = 0;
    if (!this._initialized) {
      this._est = measurement;
      this._err = this._r;
      this._initialized = true;
      this._lastValid = measurement;
      this._gain = 1;
      return { estimate: this._est, error: this._err, gain: this._gain };
    }
    let r = this._r;
    if (this._est > 0 && Math.abs(measurement - this._est) > this._est * 10) {
      r = r * 100;
    }
    const predErr = this._err + this._q;
    this._gain = predErr / (predErr + r);
    this._est = this._est + this._gain * (measurement - this._est);
    this._err = (1 - this._gain) * predErr;
    if (this._err < 1e-10) this._err = 1e-10;
    this._lastValid = this._est;
    return { estimate: this._est, error: this._err, gain: this._gain };
  }

  predict() {
    return this._est;
  }

  setProcessNoise(q) { this._q = Math.max(q, 0.001); }
  setMeasurementNoise(r) { this._r = r; }

  getState() {
    return {
      estimate: this._est,
      error: this._err,
      gain: this._gain,
      processNoise: this._q,
      measurementNoise: this._r,
      initialized: this._initialized
    };
  }

  reset() {
    this._est = this._initEst;
    this._err = this._initErr;
    this._gain = 0;
    this._initialized = false;
    this._lastValid = this._initEst;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = KalmanFilter;
