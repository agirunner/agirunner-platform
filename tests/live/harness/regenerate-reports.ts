#!/usr/bin/env node
import { regenerateLaneResults } from './report.js';

regenerateLaneResults(process.cwd());
console.log('OK: regenerated tests/reports/{core-results,integration-results,live-results}.json');
