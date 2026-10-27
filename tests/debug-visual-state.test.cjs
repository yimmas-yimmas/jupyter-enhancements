const test = require('node:test');
const assert = require('node:assert/strict');
const { nextDebugVisualPhase: next } = require('../out/debugVisualState.js');
const adapterEvent = event => ({ direction: 'adapter', type: 'event', event });
const userRequest = command => ({ direction: 'request', type: 'request', command });
test('debug cells start in blue and stop amber on breakpoint', () => {
  assert.equal(next('running', adapterEvent('stopped')), 'paused');
});
test('continue resumes blue animation', () => {
  assert.equal(next('paused', adapterEvent('continued')), 'running');
});
test('stepping resumes blue even without a continued event', () => {
  for (const command of ['next','stepIn','stepOut','continue']) {
    assert.equal(next('paused', userRequest(command)), 'running');
  }
});
test('session termination stops visuals', () => {
  assert.equal(next('paused', adapterEvent('terminated')), 'ended');
  assert.equal(next('running', adapterEvent('exited')), 'ended');
  assert.equal(next('ended', adapterEvent('stopped')), 'ended');
});
test('unrelated debug messages do not alter state', () => {
  assert.equal(next('paused', adapterEvent('output')), 'paused');
  assert.equal(next('running', userRequest('evaluate')), 'running');
});
