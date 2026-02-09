import { EJSON } from 'meteor/ejson';
import { Meteor } from 'meteor/meteor';
import { ReactiveDict } from 'meteor/reactive-dict';
import { Session } from 'meteor/session';
import { Tracker } from 'meteor/tracker';
import { amplify } from './amplify';
import { PS_KEYS, PSA_KEYS } from './constants';
import { migrate3Xto4X, migrateToEJSON } from './migrations';

declare module 'meteor/reactive-dict' {
  interface ReactiveDict {
    keys: Record<string, any>;
    allDeps?: Tracker.Dependency;
    keyDeps: Record<string, Tracker.Dependency>;
    keyValueDeps: Record<string, Record<string, Tracker.Dependency>>;
  }
}

// This file uses code direct from Meteor's reactive-dict package, mostly from
// this file: https://github.com/meteor/meteor/blob/0ef65cc/packages/reactive-dict/reactive-dict.js
//
// helpers: https://github.com/meteor/meteor/blob/0ef65cc/packages/reactive-dict/reactive-dict.js#L1-L16
const stringify = function (value: unknown) {
  if (value === undefined) {
    return 'undefined';
  }
  return EJSON.stringify(value as any);
};

const parse = function (serialized: unknown) {
  if (serialized === undefined || serialized === 'undefined') {
    return undefined;
  }
  return EJSON.parse(serialized as any);
};

const changed = function (v?: { changed: Function }) {
  v && v.changed();
};

function isObject(v: any): v is Object {
  return v != null && typeof v === 'object';
}

const hasOwn = Object.prototype.hasOwnProperty;

const hasKey = (obj: Record<string, any>, key: string) => hasOwn.call(obj, key);

const oldSession = new ReactiveDict('_session');

export enum LifetimeType {
  Temporary = 'temporary',
  Persistent = 'persistent',
  Authenticated = 'authenticated',
}

export class PersistentSession {
  private _dictName: string = '';
  private _dict: ReactiveDict;

  default_method: LifetimeType = LifetimeType.Temporary;

  // === INITIALIZE KEY TRACKING ===
  psKeys: Record<string, any> = {};
  psKeyList: string[] = [];
  psaKeys: Record<string, any> = {};
  psaKeyList: string[] = [];

  get reactiveDict() {
    return this._dict;
  }

  getPSKeys(): string[] {
    return amplify.get(PS_KEYS + this._dictName) || [];
  }

  getPSAKeys(): string[] {
    return amplify.get(PSA_KEYS + this._dictName) || [];
  }

  constructor(dictName: string) {
    if (dictName != null && typeof dictName === 'string') {
      this._dictName = dictName;

      // when "session", use the existing dict
      if (dictName === 'session') {
        this._dictName = ''; // we don't need a name for session
        this._dict = oldSession; // we also want to use the global (in case something was set previously)

        // not session? create a new dict
      } else {
        this._dict = new ReactiveDict(dictName);
      }
    } else {
      throw new Error('dictName must be a string');
    }

    // initialize default method setting
    if (Meteor.settings?.public?.persistent_session) {
      this.default_method = Meteor.settings.public.persistent_session.default_method;
    }

    if (Meteor.isClient) {
      // --- on startup, load persistent data back into meteor session ---
      Meteor.startup(() => {
        migrateToEJSON(this._dictName);
        migrate3Xto4X(this._dictName);

        // persistent data
        const psList = this.getPSKeys();

        psList.forEach(key => {
          if (hasKey(this._dict.keys, key)) return;

          const val = this.get(key);
          this.set(key, val, true, false);
        });

        // authenticated data
        const psaList = this.getPSAKeys();

        psaList.forEach(key => {
          if (hasKey(this._dict.keys, key)) return;

          const val = this.get(key);
          this.setAuth(key, val);
        });
      });
    }

    Tracker.autorun(() => {
      // lazy check for accounts-base
      if (!Meteor.userId) return;

      const userId = Meteor.userId();
      if (userId) {
        // user is logged in, leave session as is
      } else {
        // user is unset, clear authenticated keys
        this.clearAuth();
      }
    });
  }

  // === LOCAL STORAGE INTERACTION ===
  store = (type: 'get' | LifetimeType, key: string, value?: any) => {
    // use dict name for uniqueness

    if (type === 'get') {
      return amplify.get(this._dictName + key);
    }

    this.psKeyList = this.getPSKeys().filter(k => k !== key);
    this.psaKeyList = this.getPSAKeys().filter(k => k !== key);

    delete this.psKeys[key];
    delete this.psaKeys[key];

    if (value == null || type === LifetimeType.Temporary) {
      value = null;
    } else if (type === LifetimeType.Persistent) {
      this.psKeys[key] = EJSON.toJSONValue(value);
      this.psKeyList.push(key);
    } else if (type === LifetimeType.Authenticated) {
      this.psaKeys[key] = EJSON.toJSONValue(value);
      this.psaKeyList.push(key);
    }

    amplify.store(PS_KEYS + this._dictName, this.psKeyList);
    amplify.store(PSA_KEYS + this._dictName, this.psaKeyList);
    amplify.store(this._dictName + key, EJSON.toJSONValue(value));
  };

  // === GET ===
  get = (key: string) => {
    const val = this._dict.get(key);
    let psVal;
    const unparsedPsVal = this.store('get', key);
    if (unparsedPsVal !== undefined) {
      psVal = EJSON.fromJSONValue(unparsedPsVal);
    }

    /*
     * We can't do `return psVal || val;` here, as when psVal = undefined and
     * val = 0, it will return undefined, even though 0 is the correct value.
     */
    if (psVal == null) {
      return val;
    }
    return psVal;
  };

  // === SET ===
  set = (keyOrObject: Object | string, value?: any, persist?: boolean, auth?: boolean) => {
    // Taken from https://github.com/meteor/meteor/blob/107d858/packages/reactive-dict/reactive-dict.js
    if (typeof keyOrObject === 'object' && value === undefined) {
      this._setObject(keyOrObject, persist, auth);
      return;
    }

    const key = keyOrObject as string;
    let type: LifetimeType = LifetimeType.Temporary;
    if (
      persist ||
      (persist === undefined &&
        (this.default_method == LifetimeType.Persistent || this.default_method == LifetimeType.Authenticated))
    ) {
      if (auth || (persist === undefined && auth === undefined && this.default_method == LifetimeType.Authenticated)) {
        type = LifetimeType.Authenticated;
      } else {
        type = LifetimeType.Persistent;
      }
    }
    this.store(type, key, value);
    this._dict.set(key, value);
  };

  // Taken from https://github.com/meteor/meteor/blob/0ef65cc/packages/reactive-dict/reactive-dict.js#L144-L151
  // Backwards compat:
  all = () => {
    this._dict.allDeps?.depend();

    return Object.entries(this._dict.keys).reduce((acc, [key, value]) => {
      acc[key] = parse(value);
      return acc;
    }, {} as Record<string, any>);
  };

  _setObject = (object: Object, persist?: boolean, auth?: boolean) => {
    Object.entries(object).forEach(([key, val]) => this.set(key, val, persist, auth));
  };

  _ensureKey = (key: string): void => {
    const dict = this._dict;

    if (key in dict.keyDeps) return;

    dict.keyDeps[key] = new Tracker.Dependency();
    dict.keyValueDeps[key] = {};
  };

  // === EQUALS ===
  // Taken from https://github.com/meteor/meteor/blob/0ef65cc/packages/reactive-dict/reactive-dict.js#L93-L137
  equals = (key: string, value: any) => {
    // Mongo.ObjectID is in the 'mongo' package
    let ObjectID = null;
    // @ts-ignore
    if (Package['mongo']) {
      // @ts-ignore
      ObjectID = Package['mongo'].Mongo.ObjectID;
    }

    // We don't allow objects (or arrays that might include objects) for
    // .equals, because JSON.stringify doesn't canonicalize object key
    // order. (We can make equals have the right return value by parsing the
    // current value and using EJSON.equals, but we won't have a canonical
    // element of keyValueDeps[key] to store the dependency.) You can still use
    // "EJSON.equals(reactiveDict.get(key), value)".
    //
    // XXX we could allow arrays as long as we recursively check that there
    // are no objects
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      typeof value !== 'undefined' &&
      !(value instanceof Date) &&
      !(ObjectID && value instanceof ObjectID) &&
      value !== null
    ) {
      throw new Error('ReactiveDict.equals: value must be scalar');
    }

    const serializedValue = stringify(value);

    if (Tracker.active) {
      this._ensureKey(key);

      if (!hasKey(this._dict.keyValueDeps[key], serializedValue)) {
        this._dict.keyValueDeps[key][serializedValue] = new Tracker.Dependency();
      }

      const isNew = this._dict.keyValueDeps[key][serializedValue].depend();

      if (isNew) {
        const that = this;
        Tracker.onInvalidate(function () {
          // clean up [key][serializedValue] if it's now empty, so we don't
          // use O(n) memory for n = values seen ever
          if (!that._dict.keyValueDeps[key][serializedValue].hasDependents())
            delete that._dict.keyValueDeps[key][serializedValue];
        });
      }
    }

    const oldValue = this.get(key);

    return EJSON.equals(oldValue, value);
  };

  // === SET TEMPORARY ===
  // alias to .set(); sets a non-persistent variable
  setTemporary = (keyOrObject: string | Object, value: any): void => {
    this.set(keyOrObject, value, false, false);
  };

  setTemp = (keyOrObject: string | Object, value: any): void => {
    this.set(keyOrObject, value, false, false);
  };

  // === SET PERSISTENT ===
  // alias to .set(); sets a persistent variable
  setPersistent = (keyOrObject: string | Object, value: any): void => {
    this.set(keyOrObject, value, true, false);
  };

  // === SET AUTHENTICATED ===
  // alias to .set(); sets a persistent variable that will be removed on logout
  setAuth = (keyOrObject: string | Object, value: any): void => {
    this.set(keyOrObject, value, true, true);
  };

  // === MAKE TEMP / PERSISTENT / AUTH ===
  // change the type of session var
  makeTemp = (key: string): void => {
    this.store(LifetimeType.Temporary, key);
  };

  makePersistent = (key: string): void => {
    const val = this.get(key);
    this.store(LifetimeType.Persistent, key, val);
  };

  makeAuth = (key: string): void => {
    const val = this.get(key);
    this.store(LifetimeType.Authenticated, key, val);
  };

  // === CLEAR ===
  // more or less how it's implemented in reactive dict, but add support for removing single or arrays of keys
  // Derived from https://github.com/meteor/meteor/blob/0ef65cc/packages/reactive-dict/reactive-dict.js#L153-L167
  clear = (key?: string, list?: string[] | Record<string, any>) => {
    const dict = this._dict;
    const oldKeys = dict.keys;

    let keysToRemove: Record<string, any> = {};
    if (key === undefined && list === undefined) {
      keysToRemove = oldKeys;
    } else if (key !== undefined) {
      list = [key];
    }

    // okay, if it was an array of keys, find the old key pairings for reactivity
    if (list) {
      if (Array.isArray(list)) {
        const nextKeysToRemove: Record<string, any> = {};
        list.forEach(key => {
          nextKeysToRemove[key] = oldKeys[key];
        });
        keysToRemove = nextKeysToRemove;
      } else {
        keysToRemove = list;
      }
    }

    Object.entries(keysToRemove).forEach(([akey, value]) => {
      this.set(akey, undefined, false, false);

      changed(dict.keyDeps[akey]);
      if (dict.keyValueDeps[akey]) {
        changed(dict.keyValueDeps[akey][value]);
        changed(dict.keyValueDeps[akey]['undefined']);
      }

      delete dict.keys[akey]; // remove the key
    });

    // reactive-dict 1.1.0+
    dict.allDeps?.changed();
  };

  // === CLEAR TEMP ===
  // clears all the temporary keys
  clearTemp = (): void => {
    const ommitedKeys = new Set([...Object.keys(this.psKeys), ...Object.keys(this.psaKeys)]);

    const keysToClear = Object.keys(this._dict.keys).filter(k => !ommitedKeys.has(k));

    this.clear(undefined, keysToClear);
  };

  // === CLEAR PERSISTENT ===
  // clears all persistent keys
  clearPersistent = (): void => {
    this.clear(undefined, this.psKeys);
  };

  // === CLEAR AUTH ===
  // clears all authenticated keys
  clearAuth = (): void => {
    this.clear(undefined, this.psaKeys);
  };

  // === UPDATE ===
  // updates the value of a session var without changing its type
  update = (key: string, value?: any): void => {
    let persist;
    let auth;

    if (this.psaKeyList.includes(key)) {
      auth = true;
    }

    if (auth || this.psKeyList.includes(key)) {
      persist = true;
    }

    this.set(key, value, persist, auth);
  };

  // === SET DEFAULT ===
  setDefault = (keyOrObject: string | Object, value?: any, persist?: boolean, auth?: boolean): void => {
    const self = this;

    if (isObject(keyOrObject)) {
      Object.entries(keyOrObject).forEach(([key, value]) => self.setDefault(key, value, persist, auth));
      return;
    }

    if (this.get(keyOrObject) === undefined) {
      this.set(keyOrObject, value, persist, auth);
    }
  };

  // === SET DEFAULT TEMP ===
  setDefaultTemp = (keyOrObject: string | Object, value?: any): void => {
    if (isObject(keyOrObject)) {
      value = undefined;
    }

    this.setDefault(keyOrObject, value, false, false);
  };

  // === SET DEFAULT PERSISTENT ===
  setDefaultPersistent = (keyOrObject: string | Object, value?: any): void => {
    if (isObject(keyOrObject)) {
      value = undefined;
    }

    this.setDefault(keyOrObject, value, true, false);
  };

  // === SET DEFAULT AUTH ===
  setDefaultAuth = (keyOrObject: string | Object, value?: any): void => {
    if (isObject(keyOrObject)) {
      value = undefined;
    }

    this.setDefault(keyOrObject, value, true, true);
  };
}

// automatically apply PersistentSession to Session
const defaultSession = new PersistentSession('session');

Object.assign(Session, defaultSession);
