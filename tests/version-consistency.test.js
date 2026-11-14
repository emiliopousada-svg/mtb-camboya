'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('README and app fallback version match package.json', () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    const config = fs.readFileSync(path.join(root, 'app', 'config.js'), 'utf8');

    assert.match(readme, new RegExp(`Versión indicada en el proyecto: \\*\\*${version}\\*\\*`));
    assert.match(config, new RegExp(`const APP_VERSION = '${version}'`));
});
