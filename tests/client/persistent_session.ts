import { Random } from 'meteor/random';
import { Session } from 'meteor/session';
import { EJSON } from 'meteor/ejson';
import { LifetimeType, PersistentSession } from '../../lib/persistent_session';
import { amplify } from "../../lib/amplify";
import { PS_KEYS } from "../../lib/constants";
import { migrateToEJSON } from "../../lib/migrations";

Tinytest.add("Modes - defaults to temporary", function (test) {
  const TestSession = new PersistentSession(Random.id());

  test.equal('temporary', TestSession.default_method);
});

// this isn't testing anything yet...
Tinytest.add("Modes - alternate mode", function (test) {
  const TestSession = new PersistentSession(Random.id());

  // TODO: This should probably be a reactive var, just for sanity now
  TestSession.default_method = LifetimeType.Authenticated;
  test.equal('authenticated', TestSession.default_method);

  // reset to default
  TestSession.default_method = LifetimeType.Temporary;
  test.equal('temporary', TestSession.default_method);
});

Tinytest.add("Clear keys - clear all keys", function (test) {
  const TestSession = new PersistentSession(Random.id());

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 0);

  TestSession.set('foobar', 'woo');
  let result = TestSession.get('foobar');
  test.equal('woo', result);

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 1);

  TestSession.clear();

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 0);

  result = TestSession.get('foobar');
  test.equal(undefined, result);
});

Tinytest.add("Clear keys - clear auth keys", function (test) {
  const TestSession = new PersistentSession(Random.id());

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 0);

  TestSession.setAuth('foobar', 'bork');
  test.equal('bork', TestSession.get('foobar'));

  TestSession.clearAuth();

  test.equal(undefined, TestSession.get('foobar'));
});

Tinytest.add("Clear keys - skip undefined keys", function (test) {
  const TestSession = new PersistentSession(Random.id());
  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 0);

  // @ts-expect-error
  TestSession.set(undefined, 'woo');
  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 1);

  TestSession.clear();

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 0);
});

Tinytest.add("Clear keys - clear single key", function (test) {
  const TestSession = new PersistentSession(Random.id());

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 0);

  TestSession.set('foobar', 'woo');
  let result = TestSession.get('foobar');
  test.equal('woo', result);

  TestSession.set('barfoo', 'oow');
  result = TestSession.get('barfoo');
  test.equal('oow', result);

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 2);

  TestSession.clear('foobar');

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 1);

  result = TestSession.get('foobar');
  test.equal(undefined, result);

  result = TestSession.get('barfoo');
  test.equal('oow', result);
});

Tinytest.add("Clear keys - clear multiple keys", function (test) {
  const TestSession = new PersistentSession(Random.id());

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 0);

  TestSession.set('foobar', 'woo');
  let result = TestSession.get('foobar');
  test.equal('woo', result);

  TestSession.set('barfoo', 'oow');
  result = TestSession.get('barfoo');
  test.equal('oow', result);

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 2);

  TestSession.clear(undefined, ['foobar', 'barfoo']);

  test.equal(Object.keys(TestSession.reactiveDict.keys).length, 0);

  result = TestSession.get('foobar');
  test.equal(undefined, result);

  result = TestSession.get('barfoo');
  test.equal(undefined, result);
});


Tinytest.add("Get - gets undefined", function (test) {
  const TestSession = new PersistentSession(Random.id());

  const result = TestSession.get('foobar');
  test.equal(void 0, result);
});

Tinytest.add("Get - store gets persisted value", function (test) {
  const dictName = Random.id();
  amplify.store(dictName + 'foo', "awesome");
  const TestSession = new PersistentSession(dictName);
  const result = TestSession.get('foo');
  test.equal('awesome', result);
});

Tinytest.add("Set - sets & gets", function (test) {
  const TestSession = new PersistentSession(Random.id());

  // set never returns anything, although it probably should...
  let result: any = TestSession.set('something', 'amazing');
  test.equal(void 0, result);
  // did it set?
  result = TestSession.get('something');
  test.equal('amazing', result);
});

Tinytest.add("Set - sets defaults", function (test) {
  const TestSession = new PersistentSession(Random.id());

  // set never returns anything, although it probably should...
  let result: any = TestSession.setDefault('something', 'amazing');
  test.equal(void 0, result);

  // did it set?
  result = TestSession.get('something');
  test.equal('amazing', result);
});

Tinytest.add("Set - sets defaults with an object", function (test) {
  const TestSession = new PersistentSession(Random.id());

  // set never returns anything, although it probably should...
  let result: any = TestSession.setDefault({ something: 'amazing', foobar: 'awesome' });
  test.equal(void 0, result);

  // did it set?
  result = TestSession.get('something');
  test.equal('amazing', result);

  result = TestSession.get('foobar');
  test.equal('awesome', result);
});

Tinytest.add("Set - sets defaults but doesn't change if set", function (test) {
  const TestSession = new PersistentSession(Random.id());

  // set never returns anything, although it probably should...
  TestSession.set('something', 'amazing');

  let result: any = TestSession.setDefault('something', 'awesome');
  test.equal(void 0, result);

  // did it set?
  result = TestSession.get('something');
  test.equal('amazing', result);
});

Tinytest.add("Set - multiple sessions don't effect each other (never cross the streams)", function (test) {
  const TestSessionFoo = new PersistentSession(Random.id());
  const TestSessionBar = new PersistentSession(Random.id());

  TestSessionFoo.set('something', 'amazing');
  let result = TestSessionFoo.get('something');
  test.equal('amazing', result);

  TestSessionBar.set('something', 'awesome');
  result = TestSessionBar.get('something');
  test.equal('awesome', result);

  result = TestSessionFoo.get('something');
  test.equal('amazing', result);
});

Tinytest.add("Set - setDefaultPersistent sets with an object", function (test) {
  const TestSession = new PersistentSession(Random.id());

  TestSession.setDefaultPersistent({
    'id': 'foobarid',
    'room_id': 'foobarroomid'
  });

  TestSession.reactiveDict.clear();

  let result = TestSession.get('id');
  test.equal('foobarid', result);

  result = TestSession.get('room_id');
  test.equal('foobarroomid', result);
});

Tinytest.add("Set - setDefaultPersistent only sets unset keys (gh #32)", function (test) {
  const TestSession = new PersistentSession(Random.id());

  TestSession.set('room_id', 'awesome');
  let result = TestSession.get('room_id');
  test.equal('awesome', result);

  TestSession.setDefaultPersistent({
    'id': 'foobarid',
    'room_id': 'foobarroomid'
  });

  result = TestSession.get('id');
  test.equal('foobarid', result);

  result = TestSession.get('room_id');
  test.equal('awesome', result);
});


Tinytest.add("Set - setDefaultPersistent should not override an existing persisted value", function (test) {
  const dictName = Random.id();
  amplify.store(dictName + 'foo', "awesome");

  const TestSession = new PersistentSession(dictName);

  let result = TestSession.get('foo');
  test.equal('awesome', result);

  TestSession.setDefaultPersistent('foo', 'foobarid');

  result = TestSession.get('foo');
  test.equal('awesome', result);
});


Tinytest.add("Equals - equals() works", function (test) {
  const dictName = Random.id();
  amplify.store(dictName + 'foo', "awesome");

  const TestSession = new PersistentSession(dictName);

  let result = TestSession.get('foo');
  test.equal('awesome', result);

  result = TestSession.equals('foo', 'awesome');
  test.equal(true, result);
});

Tinytest.add("All - all() works", function (test) {
  const dictName = Random.id();
  // default the session with some data before creating it
  amplify.store(dictName + 'foo', "awesome");
  // since we set foo, we'll also need it's key to be set to `set` is called
  // and it ends up in the `dict.keys`
  amplify.store(PS_KEYS + dictName, ['foo']);
  amplify.store('__PSDATAVERSION__' + dictName, 4);

  const TestSession = new PersistentSession(dictName);

  let result = TestSession.get('foo');
  test.equal('awesome', result);

  TestSession.set('bar', 'thing');
  result = TestSession.get('bar');
  test.equal('thing', result);

  TestSession.setDefaultPersistent('foobar', 'stuff');
  TestSession.setAuth('foobarfoo', 'fact');
  TestSession.setPersistent('barfoobar', 'entity');

  result = TestSession.all();

  test.equal({
    "foo": "awesome",
    "bar": "thing",
    "foobar": "stuff",
    "foobarfoo": "fact",
    "barfoobar": "entity"
  }, result);
});

Tinytest.add('Session - has valid prototype', function (test) {
  // @ts-ignore
  Session.setPersistent('testkey', 1);

  test.equal(Session.get('testkey'), 1);
});

Tinytest.add("Migrations - updates from 3.x to 4.x", function (test) {
  const dictName = Random.id();
  localStorage.clear();
  // Set up 3.x-format keys/values
  localStorage['__amplify__' + dictName + 'foo'] = '{"data":"[]","expires":null}';
  localStorage['__amplify__' + dictName + 'bar'] = '{"data":"\\"noodol\\"","expires":null}';
  localStorage['__amplify__' + dictName + 'obj'] = '{"data":"{\\"obj\\":\\"val\\"}","expires":null}';
  // 4.x-format keys/values
  localStorage['__amplify__' + dictName + 'foo4'] = '{"data":[],"expires":null}';
  localStorage['__amplify__' + dictName + 'bar4'] = '{"data":"noodol","expires":null}';
  localStorage['__amplify__' + dictName + 'obj4'] = '{"data":{"obj":"val"},"expires":null}';
  amplify.store(PS_KEYS + dictName, ['foo', 'bar', 'obj', 'foo4', 'bar4', 'obj4']);
  amplify.store('__PSDATAVERSION__' + dictName, 1);

  const TestSession = new PersistentSession(dictName);
  test.equal(amplify.store('__PSDATAVERSION__' + dictName), 4);
  test.equal(TestSession.get('foo'), []);
  test.equal(TestSession.get('bar'), "noodol");
  test.equal(TestSession.get('obj'), { obj: "val" });
  test.equal(TestSession.get('foo4'), []);
  test.equal(TestSession.get('bar4'), "noodol");
  test.equal(TestSession.get('obj4'), { obj: "val" });
});

Tinytest.add("Persistence - stores key list by dict namespace", function (test) {
  localStorage.clear();
  const dictName = Random.id();
  const TestSession = new PersistentSession(dictName);

  TestSession.setPersistent('foo', 'bar');

  test.equal(amplify.store(PS_KEYS + dictName), ['foo']);
  test.equal(amplify.store(PS_KEYS), undefined);
});

Tinytest.add("Migrations - migrateToEJSON uses dict namespace", function (test) {
  localStorage.clear();
  const dictName = Random.id();
  const scopedKey = dictName + 'legacy';

  amplify.store(PS_KEYS + dictName, ['legacy']);
  amplify.store('__PSDATAVERSION__' + dictName, 0);
  amplify.store(scopedKey, { legacy: true });

  migrateToEJSON(dictName);

  test.equal(amplify.store(scopedKey), EJSON.stringify({ legacy: true }));
  test.equal(amplify.store('legacy'), undefined);
});
