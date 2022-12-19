// @ts-check

// These two should be uncommented together
// import '@agoric/zoe/tools/prepare-test-env.js';
// import test from 'ava';


import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';
// import { test } from '@agoric/notifier/test/prepare-test-env-ava.js';
// import { test } from './prepare-test-env-ava.js';

test('ses-ava', async t => {
	const test = harden({
		hello: 'hello',
	});

	t.log(test);
	t.is('is', 'is');
});

