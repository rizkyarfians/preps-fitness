import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const spec = JSON.parse(readFileSync('packages/contracts/openapi.yaml', 'utf8'));
test('contract references resolve and operation IDs are unique', () => {
 const visit = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
   if (key === '$ref') {
    assert.equal(typeof child, 'string');
    assert.ok((child as string).startsWith('#/'));
    const target = (child as string).slice(2).split('/').reduce((v, part) => v?.[part], spec);
    assert.ok(target, `Unresolved reference ${child}`);
   } else visit(child);
  }
 };
 visit(spec);
 const ids = Object.values(spec.paths).flatMap((path: any) => Object.values(path).map((op: any) => op.operationId));
 assert.equal(new Set(ids).size, ids.length);
});
test('FE generated contract types remain current', () => {
 execFileSync(process.execPath, ['apps/web/scripts/contracts.mjs', '--check']);
});
test('money contract accepts exact DECIMAL bounds and rejects numeric/localized values', () => {
 const schema = spec.components.schemas.Money.properties.amount;
 const accepts = (value: unknown) => typeof value === schema.type && new RegExp(schema.pattern).test(value as string) && (value as string).length <= schema.maxLength;
 for (const value of ['0.00', '250000.00', '0.01', '999999999999.99']) assert.ok(accepts(value));
 for (const value of [250000, '250.000,00', '1000000000000.00', '-1.00', '1.001', '01.00']) assert.equal(accepts(value), false);
});
