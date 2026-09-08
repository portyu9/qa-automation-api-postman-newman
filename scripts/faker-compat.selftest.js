'use strict';

const assert = require('node:assert/strict');
const { installFakerCompatibility } = require('./faker-compat');

installFakerCompatibility();

const fakerPackage = require('@faker-js/faker/package.json');
const dynamicVariables = require('postman-collection/lib/superstring/dynamic-variables');

assert.equal(fakerPackage.version, '10.5.0', 'security override must resolve Faker 10.5.0 exactly');

const failures = [];
let exercised = 0;
for (const [name, variable] of Object.entries(dynamicVariables)) {
  try {
    assert.equal(typeof variable.generator, 'function', `${name} generator must be callable`);
    const value = variable.generator();
    assert.notEqual(value, undefined, `${name} generator returned undefined`);
    exercised += 1;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

assert.ok(exercised >= 100, `unexpectedly small dynamic-variable surface: ${exercised}`);
assert.deepEqual(failures, [], `Faker compatibility failures:\n${failures.join('\n')}`);
console.log(`Faker 10.5 compatibility: ${exercised} Postman dynamic generators exercised`);
