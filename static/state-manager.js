// State Manager wrapping the app machine
// Provides a clean interface for the app to interact with state machine

class StateManager {
  constructor(machine) {
    this.machine = machine;
    this.state = machine.initialState;
    this.listeners = [];
  }

  send(event) {
    const transition = this.machine.transition(this.state, event);
    if (transition.changed) {
      this.state = transition;
      this.notifyListeners();
    }
    return transition;
  }

  getContext() {
    return this.state.context;
  }

  getState() {
    return this.state.value;
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notifyListeners() {
    this.listeners.forEach(listener => listener(this.state));
  }

  canHandle(eventType) {
    return this.state.nextEvents.includes(eventType);
  }
}

export { StateManager };
