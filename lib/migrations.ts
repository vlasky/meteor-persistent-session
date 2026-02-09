import { amplify } from "./amplify";
import { EJSON } from "meteor/ejson";
import { PS_KEYS, PSA_KEYS } from "./constants";

/*
 * Used to determine if we need to migrate how the data is stored.
 * Each time the data format changes, change this number.
 *
 * It should match the current major + minor version:
 * EG: 0.3 = 3, 1.2 = 12, 2.0 = 20, or for 0.3.x: 3, or 1.x: 10
 *
 */
const PSA_DATA_VERSION = 4;

const PS_DATA_VERSION = '__PSDATAVERSION__';

/*
 * Converts previously stored values into EJSON compatible formats.
 */
export function migrateToEJSON(dictName: string) {
  if (amplify.get(PS_DATA_VERSION + dictName) >= 1) {
    return;
  }

  const psKeyList = (amplify.get(PS_KEYS + dictName) || []) as string[];
  const psaKeyList = (amplify.get(PSA_KEYS + dictName) || []) as string[];

  [psKeyList, psaKeyList].forEach(list => list.forEach(key => {
      amplify.store(dictName + key, EJSON.stringify(amplify.get(dictName + key)));
    })
  );

  amplify.store(PS_DATA_VERSION + dictName, 2);
}

export function migrate3Xto4X(dictName: string) {
  if (amplify.get(PS_DATA_VERSION + dictName) >= PSA_DATA_VERSION) {
    return;
  }

  const psKeyList = (amplify.get(PS_KEYS + dictName) || []) as string[];
  const psaKeyList = (amplify.get(PSA_KEYS + dictName) || []) as string[];

  [psKeyList, psaKeyList].forEach(list => list.forEach(key => {
    let invalid = false;
    try {
      EJSON.parse(amplify.get(dictName + key));
    } catch (error) {
      //The data is already in the format that we expect
      //Unfortunately there is no EJSON.canParse method
      invalid = true;
    }
    if (!invalid) {
      const parsed = EJSON.parse(amplify.get(dictName + key));
      const jsoned = EJSON.toJSONValue(parsed);
      amplify.store(dictName + key, jsoned);
    }
  }));

  amplify.store(PS_DATA_VERSION + dictName, 4);
}
