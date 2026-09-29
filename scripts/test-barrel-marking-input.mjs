import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { GS, normalizeMarkingCodeInput, isRecognizedMotorOilMarkingCode, getMotorOilMarkingCodeError } = await jiti.import("../src/lib/marking.ts");
const identity = "0104601234567890215ABCDE1234567";
const crypto = Buffer.alloc(32, 7).toString("base64");
const canonical = `${identity}${GS}91abcd${GS}92${crypto}`;
for (const scan of [canonical, `${identity}91abcd92${crypto}`, `${identity}${GS}91abcd92${crypto}`, `${identity}91abcd${GS}92${crypto}`, `]d2${canonical}`, canonical.replaceAll(GS, "[GS]")]) {
  assert.equal(normalizeMarkingCodeInput(scan), canonical, "Full scans must retain every symbol and restore either missing separator");
  assert.equal(getMotorOilMarkingCodeError(scan), null);
}
const short = `${identity}${GS}93abcd`;
assert.equal(normalizeMarkingCodeInput(short.replace(GS, "")), short);
assert.equal(isRecognizedMotorOilMarkingCode(short), true);
// The failed production scan had 43 crypto symbols and still ended in '='.
// It must never be repaired by padding or accepted as a complete scan.
const truncated = `${identity}91abcd92${crypto.slice(0, 15)}${crypto.slice(16)}`;
assert.equal(truncated.endsWith("="), true);
assert.equal(isRecognizedMotorOilMarkingCode(truncated), false);
assert.match(getMotorOilMarkingCodeError(truncated), /43 из 44/);
assert.equal(isRecognizedMotorOilMarkingCode(`${canonical}x`), false);
assert.match(getMotorOilMarkingCodeError(`${canonical}x`), /45 из 44/);
assert.match(getMotorOilMarkingCodeError(""), /Отсканируйте/);
assert.match(getMotorOilMarkingCodeError("bad-code"), /не распознан/);
console.log("PASS barrel marking: full/compact/partial-GS scans retain identity; truncated crypto is rejected with a precise error");
