import { test } from '@agoric/swingset-vat/tools/prepare-test-env-ava.js';

import { makeNotifierKit, observeNotifier } from '@agoric/notifier';
import '@agoric/zoe/exported.js';
import { resolve as importMetaResolve } from 'import-meta-resolve';

const makeObserver = () => {
  return harden({
    updateState: state => {
      console.log(`${state.notifierName}:`);
    },
    fail: reason => console.log(`${reason}`),
    finish: done => console.log(`${done}`),
  })
}

test('notifier', async t => {
  const { updater: assetUpdaterOne, notifier: assetNotiferOne } = makeNotifierKit();
  const { updater: assetUpdaterTwo, notifier: assetNotiferTwo } = makeNotifierKit();
  const { updater: assetUpdaterThree, notifier: assetNotiferThree } = makeNotifierKit();

  observeNotifier(assetNotiferOne, makeObserver());
  observeNotifier(assetNotiferTwo, makeObserver());
  observeNotifier(assetNotiferThree, makeObserver());

  assetUpdaterOne.updateState(harden({
    notifierName: 'Notifier-ONE'
  }));

  console.log('----Waiting----')
  await new Promise(resolve => setTimeout(resolve, 1000));

  assetUpdaterTwo.updateState(harden({
    notifierName: 'Notifier-TWO'
  }));

  console.log('----Waiting----')
  await new Promise(resolve => setTimeout(resolve, 1000));

  assetUpdaterThree.updateState(harden({
    notifierName: 'Notifier-THREE'
  }));

  t.is('dummy', 'dummy');
});

test('any', async t => {
  const pro1 = new Promise((resolve, reject) => {
    setTimeout(() => resolve({ id: 'pro1' }), 100);
  });

  const pro2 = new Promise((resolve, reject) => {
    setTimeout(() => resolve({ id: 'pro2' }), 110);
  });

  const pro3 = new Promise((resolve, reject) => {
    setTimeout(() => resolve({ id: 'pro3' }), 30000);
  });

  const pro4 = new Promise((resolve, reject) => {
    setTimeout(() => resolve({ id: 'pro4' }), 40000);
  });

  let promises = {pro1, pro2, pro3, pro4};

  let response = await Promise.race(Object.values(promises))

  delete promises[response.id]

  console.log(response);
  console.log(promises);

  response = await Promise.race(Object.values(promises))
  console.log(response);
  console.log(promises);

  t.is('dummy', 'dummy');
});
