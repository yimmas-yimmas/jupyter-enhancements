const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyExecutionTransition: transition } = require('../out/executionState.js');
const state = (order=0, start=0, end=0, success=undefined) => ({ order, start, end, success });

test('new running cell starts', () => {
  assert.equal(transition(state(), state(1, 100)), 'started');
});
test('finished cell detected with timestamp', () => {
  assert.equal(transition(state(1, 100), state(1, 100, 250, true)), 'finished');
});
test('rerun with stale end time starts rather than finishes', () => {
  assert.equal(transition(state(1, 100, 250, true), state(2, 300, 250, true)), 'started');
});
test('second completion updates the result', () => {
  assert.equal(transition(state(2, 300, 250, true), state(2, 300, 400, false)), 'finished');
});
test('unchanged summaries do not trigger phantom animations', () => {
  assert.equal(transition(state(2, 300, 400, true), state(2, 300, 400, true)), 'none');
});
test('widget-triggered order-only changes must not start a phantom animation', () => {
  assert.equal(transition(state(2, 100, 200, true), state(3, 100, 200, true)), 'none');
  assert.equal(transition(state(2, 100, 200, true), state(3, 100, 200, undefined)), 'none');
  assert.equal(transition(state(2, 100, 200, true), state(3, 100, 0, undefined)), 'none');
});

test('normal new cell execution still starts after a new start timestamp', () => {
  assert.equal(transition(state(2, 100, 200, true), state(3, 300, 200, true)), 'started');
  assert.equal(transition(state(2, 100, 200, true), state(2, 300, 200, undefined)), 'started');
});
test('success with no timestamp can finish a newly identified run', () => {
  assert.equal(transition(state(1, 200, 0), state(2, 200, 0, true)), 'finished');
});
