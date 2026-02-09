Package.describe({
  name: 'vlasky:persistent-session',
  version: '0.4.14',
  summary: 'Persistently store Session data on the client. Supports Meteor 3.0.',
  git: 'https://github.com/vlasky/meteor-persistent-session',
});

function configurePackages(api) {
  api.versionsFrom(['1.8.2', '1.12', '2.3', '3.0']);
  api.use(['typescript', 'tracker', 'reactive-dict', 'session', 'ejson']);
  // If `accounts-base` is loaded, we have to make sure that this package is
  // loaded after `accounts-base` is, so we specify `weak: true` here
  api.use('accounts-base', { weak: true });
  api.mainModule('lib/persistent_session.ts', 'client');
}

Package.onUse(function (api) {
  configurePackages(api);

  api.export('PersistentSession', 'client');
});

Package.onTest(function (api) {
  configurePackages(api);
  api.use('tinytest');
  api.use('random');

  api.addFiles('tests/client/persistent_session.ts', 'client');
});
