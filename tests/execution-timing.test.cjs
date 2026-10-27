const test = require('node:test');
const assert = require('node:assert/strict');
const { compactTiming, formatExecutionDuration } = require('../out/executionTiming.js');
const { planNotebookPreferences } = require('../out/layoutProfileState.js');

const snap = (start, end, success) => ({ order:1, start, end, success });
const apply = (settings, changes) => ({
    ...settings, ...Object.fromEntries(changes.map(x => [x.key, x.value]))
});

test('Compact timing formatting covers milliseconds, seconds and minutes', () => {
    assert.equal(formatExecutionDuration(420), '420ms');
    assert.equal(formatExecutionDuration(1420), '1.42s');
    assert.equal(formatExecutionDuration(15000), '15.0s');
    assert.equal(formatExecutionDuration(75000), '1m 15s');
    assert.equal(formatExecutionDuration(-1), undefined);
});

test('Compact timing displays a completed cell without adding another row', () => {
    assert.deepEqual(compactTiming(snap(1000,1420,true), 'finished', 10000), {
      text: '✓ 420ms', tooltip: 'Cell execution succeeded — duration 420ms'
    });
    assert.deepEqual(compactTiming(snap(1000,1500,false), 'finished', 10000), {
      text: '✕ 500ms', tooltip: 'Cell execution failed — duration 500ms'
    });
});

test('Compact timing handles running, pause and unknown timestamps', () => {
    assert.equal(compactTiming(snap(1000,0,undefined), 'running', 3400).text, '● Running · 2.40s');
    assert.equal(compactTiming(snap(1000,0,undefined), 'paused', 3400).text, 'Ⅱ Paused · 2.40s');
    assert.equal(compactTiming(snap(0,0,undefined), 'running', 3400).text, '● Running');
    assert.equal(compactTiming(snap(0,0,undefined), 'finished', 3400), undefined);
    assert.equal(compactTiming(snap(0,0,true), 'finished', 3400).text, '✓ Succeeded');
});

test('Compact mode saves native status setting, sets hidden, then restores it', () => {
    const initial = { 'notebook.showCellStatusBar': 'visible' };
    const compact = planNotebookPreferences(undefined,initial,false,'compact');
    assert.deepEqual(compact.updates, [{key:'notebook.showCellStatusBar',value:'hidden'}]);
    const applied = apply(initial,compact.updates);
    const restored = planNotebookPreferences(compact.snapshot,applied,false,'native');
    assert.deepEqual(restored.updates,[{key:'notebook.showCellStatusBar',value:'visible'}]);
    assert.equal(restored.snapshot.entries.length, 0);
});

test('Balanced Compact switching native compact hidden native restores to correct target', () => {
    const original = { 'notebook.showCellStatusBar': 'visible' };
    const balancedNative = planNotebookPreferences(undefined,original,true,'native');
    assert.ok(balancedNative.updates.some(x=>x.key==='notebook.showCellStatusBar' && x.value==='visibleAfterExecute'));
    const settings1 = apply(original,balancedNative.updates);
    const balancedCompact = planNotebookPreferences(balancedNative.snapshot,settings1,true,'compact');
    assert.ok(balancedCompact.updates.some(x=>x.key==='notebook.showCellStatusBar' && x.value==='hidden'));
    const settings2 = apply(settings1,balancedCompact.updates);
    const balancedHidden = planNotebookPreferences(balancedCompact.snapshot,settings2,true,'hidden');
    assert.equal(balancedHidden.updates.length,0);
    const balancedRestoreNative = planNotebookPreferences(balancedHidden.snapshot,settings2,true,'native');
    assert.ok(balancedRestoreNative.updates.some(x=>x.key==='notebook.showCellStatusBar' && x.value==='visibleAfterExecute'));
    const settings3 = apply(settings2,balancedRestoreNative.updates);
    const standardNative = planNotebookPreferences(balancedRestoreNative.snapshot,settings3,false,'native');
    assert.equal(standardNative.updates.find(x=>x.key==='notebook.showCellStatusBar').value, 'visible');
    assert.equal(standardNative.snapshot.entries.length,0);
});

test('Switching off Balanced while keeping compact restores layout but leaves hidden row', () => {
    const compact = planNotebookPreferences(undefined,{},true,'compact');
    const applied = apply({},compact.updates);
    const justCompact = planNotebookPreferences(compact.snapshot,applied,false,'compact');
    assert.ok(justCompact.snapshot.entries.length===1);
    assert.equal(justCompact.snapshot.entries[0].key,'notebook.showCellStatusBar');
    assert.equal(justCompact.updates.some(x=>x.key==='notebook.compactView' && x.value===undefined),true);
    assert.equal(justCompact.updates.some(x=>x.key==='notebook.showCellStatusBar'),false);
});

test('Manual changes to native status preference are not reverted', () => {
    const compact = planNotebookPreferences(undefined,{ 'notebook.showCellStatusBar':'visible' },false,'compact');
    const restored = planNotebookPreferences(compact.snapshot,{ 'notebook.showCellStatusBar':'visible' },false,'native');
    assert.equal(restored.updates.length,0);
    assert.deepEqual(restored.skipped,['notebook.showCellStatusBar']);
});
