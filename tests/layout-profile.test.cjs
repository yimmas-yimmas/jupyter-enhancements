const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planBalancedLayout, planRestoreLayout, BALANCED_SCALARS
} = require('../out/layoutProfileState.js');

test('Balanced Compact applies supported notebook layout without touching cell toolbar', () => {
  const plan = planBalancedLayout({});
  const byKey = Object.fromEntries(plan.updates.map(update => [update.key, update.value]));
  assert.equal(byKey['notebook.compactView'], true);
  assert.equal(byKey['notebook.insertToolbarLocation'], 'notebookToolbar');
  assert.equal(byKey['notebook.showCellStatusBar'], 'visibleAfterExecute');
  assert.equal(byKey['notebook.editorOptionsCustomizations']['editor.fontSize'], 13);
  assert.equal(byKey['notebook.editorOptionsCustomizations']['editor.lineHeight'], 19);
  assert.equal('notebook.cellToolbarLocation' in byKey, false);
  assert.equal('notebook.lineNumbers' in byKey, false);
});

test('Restores user overrides and removes keys not originally set', () => {
  const prior = {
    'notebook.compactView': false,
    'notebook.output.fontSize': 15,
    'notebook.editorOptionsCustomizations': { 'editor.wordWrap': 'on', 'editor.fontSize': 16 }
  };
  const { snapshot, updates } = planBalancedLayout(prior);
  const applied = { ...prior, ...Object.fromEntries(updates.map(x => [x.key, x.value])) };
  const restore = planRestoreLayout(snapshot, applied);
  const byKey = Object.fromEntries(restore.updates.map(x => [x.key, x.value]));
  assert.equal(byKey['notebook.compactView'], false);
  assert.equal(byKey['notebook.output.fontSize'], 15);
  assert.equal(byKey['notebook.output.lineHeight'], undefined);
  assert.equal(byKey['notebook.insertToolbarLocation'], undefined);
  assert.deepEqual(byKey['notebook.editorOptionsCustomizations'], {
    'editor.wordWrap': 'on', 'editor.fontSize': 16
  });
});

test('Changes to unrelated notebook editor options survive restore', () => {
  const original = { 'notebook.editorOptionsCustomizations': { 'editor.wordWrap': 'on' } };
  const { snapshot, updates } = planBalancedLayout(original);
  const applied = { ...original, ...Object.fromEntries(updates.map(x => [x.key, x.value])) };
  applied['notebook.editorOptionsCustomizations'] = {
    ...applied['notebook.editorOptionsCustomizations'],
    'editor.minimap.enabled': false
  };
  const result = planRestoreLayout(snapshot, applied);
  const restored = result.updates.find(x => x.key === 'notebook.editorOptionsCustomizations').value;
  assert.deepEqual(restored, { 'editor.wordWrap': 'on', 'editor.minimap.enabled': false });
});

test('Do not clobber manual edits to managed values when restoring', () => {
  const { snapshot, updates } = planBalancedLayout({
    'notebook.compactView': false,
    'notebook.editorOptionsCustomizations': { 'editor.fontSize': 16 }
  });
  const applied = Object.fromEntries(updates.map(x => [x.key, x.value]));
  applied['notebook.compactView'] = false;
  applied['notebook.editorOptionsCustomizations'] = {
    ...applied['notebook.editorOptionsCustomizations'],
    'editor.fontSize': 17
  };
  const result = planRestoreLayout(snapshot, applied);
  assert.equal(result.updates.some(x => x.key === 'notebook.compactView'), false);
  const options = result.updates.find(x => x.key === 'notebook.editorOptionsCustomizations').value;
  assert.equal(options['editor.fontSize'], 17);
  assert.equal(result.skipped.includes('notebook.compactView'), true);
  assert.equal(result.skipped.includes('notebook.editorOptionsCustomizations.editor.fontSize'), true);
});

test('No writes for matching user-global preferences', () => {
  const same = Object.fromEntries(BALANCED_SCALARS.map(x => [x.key,x.value]));
  same['notebook.editorOptionsCustomizations'] = { 'editor.fontSize':13, 'editor.lineHeight':19 };
  assert.equal(planBalancedLayout(same).updates.length, 0);
});
