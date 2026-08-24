import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});

const {
  MANN_MIN_PRESENTABLE_SCORE,
  evaluateMannCandidate,
  mannFuelCompatibility,
  normalizeMannFuel,
  normalizeDecodedVehicleForTest,
  rankMannCandidatesForTest,
} = await jiti.import("../src/lib/mann-vehicle-resolver.ts");
const {
  isValidMannYear,
  normalizeMannYearInput,
  shouldApplyMannRequest,
} = await jiti.import("../src/lib/mann-picker-state.ts");
const {
  filterMannVehicleVariants,
  isMannNonVehicleVariantText,
} = await jiti.import("../src/lib/mann-catalog.ts");

const vehicle = (fields) => ({
  sourceMethods: ["tronk_vindecode"],
  confidence: "high",
  rawResultIds: [],
  vinStatus: "valid",
  ...fields,
});

const row = (fields) => ({
  vehicleVariantKey: fields.vehicleVariantKey ?? fields.model,
  make: fields.make,
  makeNormalized: fields.make,
  model: fields.model,
  modelNormalized: fields.model,
  vehicleText: fields.vehicleText ?? null,
  effectiveVehicleText: fields.effectiveVehicleText ?? null,
  engineCode: fields.engineCode ?? null,
  engineCodeNormalized: fields.engineCode ?? null,
  kw: fields.kw ?? null,
  hp: fields.hp ?? null,
  vehicleYears: fields.vehicleYears ?? null,
  vehicleYearFrom: fields.vehicleYearFrom ?? null,
  vehicleYearTo: fields.vehicleYearTo ?? null,
  condition: fields.condition ?? null,
});

const ford = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "FORD",
  modelRaw: "Mondeo",
  generationRaw: "V",
  year: 2014,
  engineVolumeCc: 2488,
  powerHp: 149,
  fuelType: "GASOLINE",
}));
assert.deepEqual(
  { make: ford?.canonicalMake, model: ford?.baseModel, generation: ford?.generation, year: ford?.year, volume: ford?.engineVolumeCc, hp: ford?.powerHp },
  { make: "FORD", model: "MONDEO", generation: "V", year: 2014, volume: 2488, hp: 149 },
);
const fordThird = evaluateMannCandidate(ford, row({
  make: "FORD", model: "Mondeo III (B4Y)", vehicleText: "2.5 l", vehicleYearFrom: 2000, vehicleYearTo: 2007,
}));
assert.ok(fordThird.candidate?.mismatchedFields.includes("поколение"));
assert.ok(fordThird.candidate?.mismatchedFields.includes("год"));
const fordFifth = evaluateMannCandidate(ford, row({
  make: "FORD", model: "Mondeo V", vehicleText: "2.5 l", hp: "149", vehicleYearFrom: 2014, vehicleYearTo: 2019,
}));
assert.ok(fordFifth.candidate, "Mondeo V remains a valid candidate");
assert.ok(fordFifth.candidate.score > fordThird.candidate.score, "matching evidence outranks a conflicting generation without hiding the alternative");
const fordScreenshotBoundary = evaluateMannCandidate(ford, row({
  make: "FORD",
  model: "Mondeo V",
  vehicleText: "2.5(CNG)",
  engineCode: "C25HDEX",
  kw: "110",
  hp: "150",
  vehicleYears: "05/15 ->",
  vehicleYearFrom: 2015,
}));
assert.ok(fordScreenshotBoundary.candidate, "matching generation, 2.5 displacement and 150 hp retain the adjacent MANN year as confirmable");
assert.ok(fordScreenshotBoundary.candidate?.mismatchedFields.includes("год"));
assert.ok(fordScreenshotBoundary.candidate?.matchedFields.includes("объём двигателя"));
assert.ok(fordScreenshotBoundary.candidate?.matchedFields.includes("мощность"));
assert.ok(fordScreenshotBoundary.candidate?.warnings.some((warning) => warning.includes("Граница модельного года")));
assert.equal(normalizeMannFuel("2.0BiFuel"), "bifuel");
assert.equal(normalizeMannFuel("1.6 DDiS"), "diesel");
assert.equal(normalizeMannFuel("PHEV"), "phev");
assert.equal(normalizeMannFuel("MHEV"), "mhev");
assert.equal(mannFuelCompatibility("gasoline", "bifuel"), "conflict");
assert.equal(mannFuelCompatibility("bifuel", "lpg"), "compatible");
assert.equal(mannFuelCompatibility("gasoline", "hev"), "conditional");
assert.ok(fordScreenshotBoundary.candidate?.mismatchedFields.includes("топливо"), "plain gasoline must not auto-match a CNG application");
assert.ok(evaluateMannCandidate(ford, row({
  make: "FORD", model: "Mondeo V", vehicleText: "2.0TDCi", vehicleYearFrom: 2014, vehicleYearTo: 2019,
})).candidate?.mismatchedFields.includes("объём двигателя"), "2.0TDCi remains visible but is penalized against 2.488 l");
assert.ok(evaluateMannCandidate(ford, row({
  make: "FORD", model: "Mondeo V", vehicleText: "All models",
})).rejected?.reasons.some((reason) => reason.includes("общая применяемость")), "All models is context, not a selectable vehicle variant");

const mercedesGl = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "Mercedes-Benz",
  modelRaw: "GL-Класс",
  year: 2013,
}));
assert.deepEqual(
  { make: mercedesGl?.canonicalMake, model: mercedesGl?.baseModel, year: mercedesGl?.year },
  { make: "MERCEDES", model: "GL", year: 2013 },
);
const mercedesGlMann = evaluateMannCandidate(mercedesGl, row({
  make: "MERCEDES-BENZ",
  model: "GL-Klasse (X166)",
  vehicleText: "GL 350 BlueTEC 4-matic",
  vehicleYearFrom: 2012,
  vehicleYearTo: 2015,
}));
assert.ok(mercedesGlMann.candidate, "Russian GL-Класс matches the MANN GL-Klasse (X166) model family");
assert.ok(mercedesGlMann.candidate?.matchedFields.includes("базовая модель"));
const mercedesGlEnglish = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "Mercedes-Benz",
  modelRaw: "Mercedes-Benz GL-Class",
  year: 2013,
}));
assert.equal(mercedesGlEnglish?.baseModel, "GL");

const mercedesGlk = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "MERCEDES-BENZ", modelRaw: "GLK 300", year: 2012 }));
assert.deepEqual({ model: mercedesGlk?.baseModel, codes: mercedesGlk?.bodyCodes }, { model: "GLK", codes: [] });
assert.ok(evaluateMannCandidate(mercedesGlk, row({
  make: "MERCEDES-BENZ", model: "GLK(X204)", vehicleText: "GLK300(204.981)", vehicleYearFrom: 2008, vehicleYearTo: 2015,
})).candidate, "a commercial Mercedes GLK 300 name resolves to the GLK model family");

const landCruiser200 = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "TOYOTA", modelRaw: "Land Cruiser 200 V8", year: 2008 }));
assert.deepEqual({ model: landCruiser200?.baseModel, codes: landCruiser200?.bodyCodes }, { model: "LAND CRUISER 200 V8", codes: [] });
assert.ok(evaluateMannCandidate(landCruiser200, row({
  make: "TOYOTA", model: "Land Cruiser", vehicleText: "4.7 V8(J20)", vehicleYearFrom: 2007, vehicleYearTo: 2011,
})).candidate, "Land Cruiser 200 V8 stays in the Land Cruiser family without treating V8 as a body code");

const bmw520d = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "BMW", modelRaw: "520D", year: 2018 }));
assert.deepEqual({ model: bmw520d?.baseModel, codes: bmw520d?.bodyCodes }, { model: "5", codes: [] });
assert.ok(evaluateMannCandidate(bmw520d, row({
  make: "BMW", model: "5(G30,G31,F90)", vehicleText: "520d(G30)", vehicleYearFrom: 2016,
})).candidate, "BMW derivative names such as 520D resolve to the 5-series family");

const corollaXi = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "TOYOTA", modelRaw: "Corolla", generationRaw: "XI", year: 2015 }));
assert.equal(corollaXi?.generation, "XI");
assert.ok(evaluateMannCandidate(corollaXi, row({
  make: "TOYOTA", model: "Corolla XI(E18)", vehicleText: "1.6VVT-i", vehicleYearFrom: 2013, vehicleYearTo: 2018,
})).candidate, "Roman generations above X are retained and matched");
const corollaChassis = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "TOYOTA", modelRaw: "Corolla", generationRaw: "XI", bodyName: "ZRE182", year: 2015,
  engineSeries: "2ZRFE", engineVolumeCc: 1797, powerHp: 140,
}));
assert.ok(evaluateMannCandidate(corollaChassis, row({
  make: "TOYOTA", model: "Corolla XI(E18)", vehicleText: "1.8VVT-i", engineCode: "2ZR-FE",
  hp: "136", vehicleYearFrom: 2013, vehicleYearTo: 2018,
})).candidate, "a detailed chassis such as ZRE182 is compatible with its MANN E18 family code");

const corollaNde150 = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "TOYOTA", modelRaw: "Corolla", generationRaw: "X", bodyName: "NDE150", year: 2008,
  engineVolumeCc: 1364, powerKw: 66, powerHp: 90, fuelType: "D",
}));
const corollaNde150Candidates = rankMannCandidatesForTest(corollaNde150, [
  row({
    vehicleVariantKey: "corolla-1nd", make: "TOYOTA", model: "Corolla", vehicleText: "1.4D-4D",
    engineCode: "1ND-TV", kw: "66", hp: "90", vehicleYearFrom: 2007, vehicleYearTo: 2014,
  }),
  row({
    vehicleVariantKey: "corolla-carbon", make: "TOYOTA", model: "Corolla X(E14/E15)",
    vehicleText: "Aktivkohlefilter/ActivatedCarbonFilter(60)",
  }),
  row({
    vehicleVariantKey: "corolla-bio", make: "TOYOTA", model: "Corolla X(E14/E15)",
    vehicleText: "BiofunktionalerInnenraumfilter/Biofunctionalcabinairfilter(298)",
  }),
]);
assert.deepEqual(corollaNde150Candidates.map((candidate) => candidate.applicationId), ["corolla-1nd"]);
assert.equal(corollaNde150Candidates[0]?.effectiveVehicleText ?? corollaNde150Candidates[0]?.vehicleText, "1.4D-4D");
assert.equal(isMannNonVehicleVariantText("Aktivkohlefilter/ActivatedCarbonFilter(60)"), true);
assert.equal(isMannNonVehicleVariantText("BiofunktionalerInnenraumfilter/Biofunctionalcabinairfilter(298)"), true);
assert.deepEqual(
  filterMannVehicleVariants([
    { variantId: "real", vehicleText: "1.4D-4D", effectiveVehicleText: "1.4D-4D" },
    { variantId: "carbon", vehicleText: "Aktivkohlefilter/ActivatedCarbonFilter(60)", effectiveVehicleText: null },
    { variantId: "bio", vehicleText: "BiofunktionalerInnenraumfilter/Biofunctionalcabinairfilter(298)", effectiveVehicleText: null },
  ]).map((variant) => variant.variantId),
  ["real"],
  "manual MANN variant lists apply the same qualifier filter as the automatic resolver",
);

const mazdaZ6 = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "MAZDA", modelRaw: "3", generationRaw: "I", year: 2006,
  engineSeries: "Z6", engineVolumeCc: 1598, powerHp: 105,
}));
assert.ok(evaluateMannCandidate(mazdaZ6, row({
  make: "MAZDA", model: "3(BK)", vehicleText: "1.6", engineCode: "Z601,Z627",
  hp: "105", vehicleYearFrom: 2003, vehicleYearTo: 2009,
})).candidate, "short engine series Z6 matches detailed Z601/Z627 MANN codes");

const newActyon = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "SSANGYONG", modelRaw: "New Actyon", generationRaw: "III", year: 2012 }));
assert.equal(newActyon?.baseModel, "ACTYON");
assert.ok(evaluateMannCandidate(newActyon, row({
  make: "SSANGYONG", model: "Actyon/Actyon Sports", vehicleText: "2.0Xdi", vehicleYearFrom: 2011,
})).candidate, "the Russian-market New Actyon name resolves to the MANN Actyon family");

const miniCooper = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "MINI", modelRaw: "Cooper", generationRaw: "II (R56) Рестайлинг", bodyName: "R56N",
  year: 2010, engineVolumeCc: 1598, powerHp: 122,
}));
assert.equal(miniCooper?.baseModel, "COOPER");
assert.ok(evaluateMannCandidate(miniCooper, row({
  make: "MINI (BMW GROUP)", model: "Mini Cooper II,Cabr,Coupé,Club/Country/Pacem./Road",
  vehicleText: "1.6(R55,R56,R57,R58,R59,R60,R61)", engineCode: "N16B16A", hp: "122",
  vehicleYearFrom: 2010, vehicleYearTo: 2016,
})).candidate, "TRONK Cooper matches the long grouped MANN Mini Cooper heading");

const highlander = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "TOYOTA", modelRaw: "Highlander", generationRaw: "III", year: 2017, engineVolumeCc: 3456 }));
assert.deepEqual({ model: highlander?.baseModel, generation: highlander?.generation }, { model: "HIGHLANDER", generation: "III" });
assert.ok(evaluateMannCandidate(highlander, row({ make: "TOYOTA", model: "Highlander II", vehicleYearFrom: 2007, vehicleYearTo: 2013 })).candidate?.mismatchedFields.includes("поколение"));
assert.ok(evaluateMannCandidate(highlander, row({ make: "TOYOTA", model: "Highlander III", vehicleYearFrom: 2014, vehicleYearTo: 2019 })).candidate);
assert.ok(evaluateMannCandidate(highlander, row({ make: "TOYOTA", model: "Highlander III", vehicleText: "2.7", vehicleYearFrom: 2014, vehicleYearTo: 2019 })).candidate?.mismatchedFields.includes("объём двигателя"), "2.7 is penalized against 3.456 l");

const noisyCayenne = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "PORSCHE", modelRaw: "BEZ MODELI SAUENNE", year: 2004, powerHp: 250 }));
const noisyCayenneCandidates = rankMannCandidatesForTest(noisyCayenne, [
  row({ vehicleVariantKey: "cayenne-32", make: "PORSCHE", model: "Cayenne", vehicleText: "3.2", hp: "250", vehicleYearFrom: 2003, vehicleYearTo: 2007 }),
  row({ vehicleVariantKey: "panamera", make: "PORSCHE", model: "Panamera", vehicleText: "3.6", hp: "300", vehicleYearFrom: 2009, vehicleYearTo: 2013 }),
]);
assert.equal(noisyCayenneCandidates[0]?.applicationId, "cayenne-32", "strong year+power anchors retrieve a candidate when provider model text is malformed");
assert.ok(noisyCayenneCandidates[0]?.mismatchedFields.includes("базовая модель"), "anchor retrieval does not pretend that the model text matched");

const xTrail = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "NISSAN", modelRaw: "X-Trail", year: 2011 }));
assert.deepEqual({ model: xTrail?.baseModel, generation: xTrail?.generation }, { model: "X TRAIL", generation: undefined });
assert.ok(evaluateMannCandidate(xTrail, row({
  make: "NISSAN", model: "X-Trail II(T31)", vehicleText: "2.0dCi(T31)", vehicleYearFrom: 2007, vehicleYearTo: 2014,
})).candidate, "X-Trail keeps X as part of the model name");

const teana = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "NISSAN", modelRaw: "Teana", year: 2011, engineSeries: "QR25DE", engineVolumeCc: 2488,
}));
const teanaCatalogContinuation = evaluateMannCandidate(teana, row({
  make: "NISSAN", model: "Teana II(J32)", vehicleText: "266 2.54WD +++ For our complete",
  effectiveVehicleText: "266 2.54WD +++ For our complete", engineCode: "QR25DE",
  vehicleYearFrom: 2008, vehicleYearTo: 2013,
}));
assert.equal(
  teanaCatalogContinuation.candidate?.effectiveVehicleText,
  "2.5 4WD",
  "a MANN PDF continuation artifact is cleaned into its actual vehicle variant",
);

const pajeroMini = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "MITSUBISHI", modelRaw: "Pajero Mini", generationRaw: "II", year: 2008,
}));
assert.ok(evaluateMannCandidate(pajeroMini, row({
  make: "MITSUBISHI", model: "Pajero II", vehicleText: "3.2DiD", vehicleYearFrom: 2000, vehicleYearTo: 2012,
})).rejected?.reasons.some((reason) => reason.includes("базовая модель")), "Pajero Mini must not collapse into the full-size Pajero family");
assert.ok(evaluateMannCandidate(pajeroMini, row({
  make: "MITSUBISHI", model: "Pajero Mini II", vehicleText: "0.7", vehicleYearFrom: 1998, vehicleYearTo: 2012,
})).candidate, "Pajero Mini keeps its distinctive model token");

const kiaCeed = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "KIA", modelRaw: "Ceed", year: 2015 }));
assert.ok(evaluateMannCandidate(kiaCeed, row({
  make: "KIA MOTORS", model: "Cee’d II/Pro Cee’d II/Sports Wagon II(JD)", vehicleText: "1.6GDI", vehicleYearFrom: 2012, vehicleYearTo: 2018,
})).candidate, "KIA MOTORS and a slash-separated Cee’d family match canonical KIA Ceed");

const bmw5Gt = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "BMW", modelRaw: "5 GT", year: 2012 }));
assert.ok(evaluateMannCandidate(bmw5Gt, row({
  make: "BMW", model: "5GT(F07GT)", vehicleText: "530d(F07GT)", vehicleYearFrom: 2009, vehicleYearTo: 2017,
})).candidate, "BMW 5 GT spacing is normalized against MANN 5GT");

const renault16 = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "RENAULT", modelRaw: "Captur", year: 2019, engineVolumeCc: 1598 }));
assert.ok(evaluateMannCandidate(renault16, row({
  make: "RENAULT", model: "Captur(J5,H5)", vehicleText: "1.5dCi", vehicleYearFrom: 2013, vehicleYearTo: 2019,
})).candidate?.mismatchedFields.includes("объём двигателя"), "a 1.6 litre input penalizes a 1.5 litre MANN engine");

const civic = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "HONDA", modelRaw: "Civic", generationRaw: "VII", year: 2002 }));
assert.deepEqual({ model: civic?.baseModel, generation: civic?.generation, year: civic?.year }, { model: "CIVIC", generation: "VII", year: 2002 });
assert.notEqual(civic?.baseModel, "E");
assert.ok(evaluateMannCandidate(civic, row({ make: "HONDA", model: "Civic VII", vehicleYearFrom: 2000, vehicleYearTo: 2005 })).candidate);

const bmwX1 = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "BMW", modelRaw: "X1(E84)", year: 2008 }));
const bmwPdfQualifier = evaluateMannCandidate(bmwX1, row({
  make: "BMW",
  model: "X1(E84)",
  vehicleText: "Exportmodellfür/Exportmodelfor(1005)",
  engineCode: "China.Sonderausstattung:/Optionalextra:(1016)",
  kw: "1",
  vehicleYears: "CodeS1AKA",
}));
assert.ok(bmwPdfQualifier.rejected?.reasons.some((reason) => reason.includes("служебное условие PDF")));
const bmwWrongBody = evaluateMannCandidate(bmwX1, row({
  make: "BMW",
  model: "X1(F48)",
  vehicleText: "2.0",
}));
assert.ok(bmwWrongBody.candidate?.mismatchedFields.includes("код кузова"));

const bmwX5 = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "BMW",
  modelRaw: "X5 II (E70)",
  year: 2007,
  engineSeries: "M57 D30",
  engineVolumeCc: 2993,
  powerHp: 286,
}));
const bmwX5Mann = evaluateMannCandidate(bmwX5, row({
  make: "BMW",
  model: "X5 (E70)",
  vehicleText: "3.0sd",
  engineCode: "M57 D30 (306D5)",
  kw: "210",
  hp: "286",
  vehicleYearFrom: 2007,
  vehicleYearTo: 2008,
}));
assert.ok(bmwX5Mann.candidate, "a short TRONK M57 code matches the detailed MANN M57 D30 (306D5) code");
assert.ok(bmwX5Mann.candidate?.matchedFields.includes("семейство двигателя"));
assert.ok(bmwX5Mann.candidate?.matchedFields.includes("объём двигателя"));
assert.ok(bmwX5Mann.candidate?.matchedFields.includes("мощность"));

const passatB6 = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "VOLKSWAGEN",
  modelRaw: "Passat B6",
  generationRaw: "B6",
  bodyName: "Седан",
  year: 2005,
  engineVolumeCc: 1984,
  powerKw: 110,
  powerHp: 150,
  transmissionType: "MECHANICAL",
}));
assert.deepEqual(
  { model: passatB6?.baseModel, generation: passatB6?.generation, bodyCodes: passatB6?.bodyCodes },
  { model: "PASSAT B6", generation: undefined, bodyCodes: ["B6"] },
  "Passat B6 stays a generic model/body token without a one-off marketing alias",
);
const rankedPassatB6 = rankMannCandidatesForTest(passatB6, [
  row({
    vehicleVariantKey: "passat-b6-fsi",
    make: "VOLKSWAGEN",
    model: "Passat B6(3C2/3C5)/Passat CCB6(357)",
    vehicleText: "2.0FSI",
    engineCode: "BLR/X/Y,BVX/Y/Z",
    kw: "110",
    hp: "150",
    vehicleYearFrom: 2005,
    vehicleYearTo: 2010,
  }),
  row({
    vehicleVariantKey: "passat-b6-tdi",
    make: "VOLKSWAGEN",
    model: "Passat B6(3C2/3C5)/Passat CCB6(357)",
    vehicleText: "2.0TDI",
    kw: "103",
    hp: "140",
    vehicleYearFrom: 2005,
    vehicleYearTo: 2010,
  }),
  row({
    vehicleVariantKey: "passat-b55-tdi",
    make: "VOLKSWAGEN",
    model: "Passat B5.5(3B2/3B5)",
    vehicleText: "2.5TDIV6",
    kw: "110",
    hp: "150",
    vehicleYearFrom: 2000,
    vehicleYearTo: 2005,
  }),
]);
assert.equal(rankedPassatB6[0]?.applicationId, "passat-b6-fsi");
assert.equal(rankedPassatB6[0]?.confidence, "medium", "without an engine code or fuel signal the Passat remains confirmable, not automatic");
assert.ok(rankedPassatB6[0]?.matchedFields.includes("код кузова"));
assert.ok(rankedPassatB6[0]?.matchedFields.includes("объём двигателя"));
assert.ok(rankedPassatB6[0]?.matchedFields.includes("мощность"));
for (const qualifier of [
  "fürkalteKlimazonen/forcoldclimates(116)",
  "Einbaurechts/Rightside(326)",
  "staubreicheEinsatzbedingungen/useindustyenvironments(51)",
  "Linkslenker/left-handdrive(31)",
  "Einspritzsystem/Injectionsystem(1002)",
  "Automatikgetriebe/Automaticgearbox(2).Getriebe-Code/Gearboxcode(1010)",
  "Aktivkohlefilter/ActivatedCarbonFilter(60)",
  "BiofunktionalerInnenraumfilter/Biofunctionalcabinairfilter(298)",
]) {
  assert.ok(evaluateMannCandidate(bmwX5, row({
    make: "BMW",
    model: "X5 (E70)",
    vehicleText: qualifier,
  })).rejected?.reasons.some((reason) => reason.includes("служебное условие PDF")), `${qualifier} is not a vehicle modification`);
}

const sportage = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "KIA", modelRaw: "Sportage", generationRaw: "IV", bodyName: "QLE", year: 2018,
  engineSeries: "G4NA", engineVolumeCc: 1999, powerHp: 150,
}));
assert.ok(evaluateMannCandidate(sportage, row({
  make: "KIA MOTORS", model: "Sportage III(SL)", vehicleText: "2.0", engineCode: "G4NA", hp: "150", vehicleYearFrom: 2010,
})).candidate?.mismatchedFields.includes("поколение"), "a conflicting generation remains visible but receives negative evidence");
assert.ok(evaluateMannCandidate(sportage, row({
  make: "KIA MOTORS", model: "Sportage IV(QL,QLE)", vehicleText: "176 2.0 +++ For our complete",
  engineCode: "NU/G4NA and always up-to-date", hp: "150", vehicleYearFrom: 2015,
})).candidate?.matchedFields.includes("точный код двигателя"), "PDF footer contamination is removed from an otherwise exact engine code");

const rankedX5 = rankMannCandidatesForTest(
  normalizeDecodedVehicleForTest(vehicle({
    makeRaw: "BMW", modelRaw: "X5", bodyName: "G05", year: 2018,
    engineSeries: "B57D30", engineVolumeCc: 2993, powerHp: 249,
  })),
  [
    row({
      vehicleVariantKey: "x5-249", make: "BMW", model: "X5(G05,F95)", vehicleText: "3.0 30dxDrive(G05)",
      engineCode: "B57D30A", hp: "249", vehicleYearFrom: 2018, vehicleYearTo: 2020,
    }),
    row({
      vehicleVariantKey: "x5-265", make: "BMW", model: "X5(G05,F95)", vehicleText: "3.0 30dxDrive(G05)",
      engineCode: "B57D30A", hp: "265", vehicleYearFrom: 2018, vehicleYearTo: 2020,
    }),
  ],
);
assert.equal(rankedX5[0]?.confidence, "high", "a chassis, engine-family, volume and exact-power match wins over a conflicting tune");
assert.equal(rankedX5[1]?.confidence, "medium");

const haval = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "HAVAL", modelRaw: "Jolion", generationRaw: "I", year: 2020,
  engineSeries: "GW4G15K", engineVolumeCc: 1497, powerHp: 143,
}));
const havalBoundary = evaluateMannCandidate(haval, row({
  make: "HAVAL", model: "Jolion", vehicleText: "1.5T", engineCode: "GW4G15K", kw: "105", hp: "143", vehicleYearFrom: 2021,
}));
assert.ok(havalBoundary.candidate, "one-year MANN boundary with an exact engine remains confirmable");
assert.ok(havalBoundary.candidate?.mismatchedFields.includes("год"));
assert.ok(havalBoundary.candidate?.warnings.some((warning) => warning.includes("Граница модельного года")));
assert.ok(evaluateMannCandidate(haval, row({
  make: "HAVAL", model: "Jolion", vehicleText: "1.5T", engineCode: "GW4G15K", kw: "105", hp: "143", vehicleYearFrom: 2022,
})).candidate?.mismatchedFields.includes("год"), "a two-year mismatch is penalized more strongly than a boundary mismatch");

// Algorithmic invariants: these protect whole classes of vehicles and do not encode
// any plate, VIN or one-off production answer.
const invariantVehicle = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "BMW", modelRaw: "X5", bodyName: "G05", year: 2019,
  engineSeries: "B57D30A", engineVolumeCc: 2993, powerHp: 249, fuelType: "DIESEL",
}));
const invariantRows = [
  row({
    vehicleVariantKey: "exact-a", make: "BMW", model: "X5(G05,F95)", vehicleText: "3.0d xDrive(G05)",
    engineCode: "B57D30A", hp: "249", vehicleYearFrom: 2018, vehicleYearTo: 2021,
  }),
  row({
    vehicleVariantKey: "exact-b", make: "BMW", model: "X5(G05,F95)", vehicleText: "3.0d xDrive(G05)",
    engineCode: "B57D30A", hp: "249", vehicleYearFrom: 2018, vehicleYearTo: 2021,
    condition: "Linkslenker/left-hand drive",
  }),
  row({
    vehicleVariantKey: "wrong-engine", make: "BMW", model: "X5(G05,F95)", vehicleText: "4.4i(G05)",
    engineCode: "N63B44", hp: "530", vehicleYearFrom: 2018, vehicleYearTo: 2021,
  }),
  row({ vehicleVariantKey: "irrelevant", make: "TOYOTA", model: "Camry VII", vehicleText: "2.5" }),
];
const invariantRanking = rankMannCandidatesForTest(invariantVehicle, invariantRows);
assert.equal(invariantRanking[0]?.applicationId, "exact-a");
assert.deepEqual(new Set(invariantRanking[0]?.variantIds), new Set(["exact-a", "exact-b"]), "semantic duplicate rows consolidate and keep every filter-bearing variant ID");
assert.ok(invariantRanking[0].score > invariantRanking[1].score, "exact engine, body, year and power evidence outrank a conflicting powertrain");
assert.ok(invariantRanking.every((candidate) => candidate.score >= 0 && candidate.score <= 100), "all scores stay inside the documented 0-100 range");
assert.ok(invariantRanking.slice(1).every((candidate) => candidate.confidence !== "high"), "only Top-1 may receive high confidence");
assert.deepEqual(
  rankMannCandidatesForTest(invariantVehicle, [...invariantRows].reverse()).map((candidate) => [candidate.applicationId, candidate.score]),
  invariantRanking.map((candidate) => [candidate.applicationId, candidate.score]),
  "ranking is stable when source rows are shuffled",
);
assert.deepEqual(
  rankMannCandidatesForTest(invariantVehicle, invariantRows.slice(0, 3)).map((candidate) => [candidate.applicationId, candidate.score]),
  invariantRanking.map((candidate) => [candidate.applicationId, candidate.score]),
  "an irrelevant make cannot perturb the ranking",
);

const gasolineSportage = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "KIA", modelRaw: "Sportage", generationRaw: "II", year: 2009,
  engineSeries: "G4GC", engineVolumeCc: 1975, powerHp: 141, fuelType: "PO",
}));
const sportageFuelRanking = rankMannCandidatesForTest(gasolineSportage, [
  row({ vehicleVariantKey: "gasoline", make: "KIA MOTORS", model: "Sportage II(JE_)", vehicleText: "2.0i", engineCode: "G4GC", hp: "141", vehicleYearFrom: 2004, vehicleYearTo: 2010 }),
  row({ vehicleVariantKey: "lpg", make: "KIA MOTORS", model: "Sportage II(JE_)", vehicleText: "2.0LPG", engineCode: "G4GC", hp: "137", vehicleYearFrom: 2009, vehicleYearTo: 2010 }),
]);
assert.equal(sportageFuelRanking[0]?.applicationId, "gasoline", "a glued LPG marker is parsed and cannot tie a gasoline modification");
assert.ok(sportageFuelRanking[1]?.mismatchedFields.includes("топливо"));

const contradictoryMazda = evaluateMannCandidate(
  normalizeDecodedVehicleForTest(vehicle({ makeRaw: "MAZDA", modelRaw: "6", generationRaw: "I", year: 2005, engineVolumeCc: 2967, powerHp: 220 })),
  row({ vehicleVariantKey: "wrong-mazda", make: "MAZDA", model: "6(GG/GY)", vehicleText: "2.0", engineCode: "LF", hp: "141", vehicleYearFrom: 2002, vehicleYearTo: 2007 }),
).candidate;
assert.ok(contradictoryMazda && contradictoryMazda.score < MANN_MIN_PRESENTABLE_SCORE, "a same-model row with contradictory displacement and power is not presentable as a match");

const prefixedPlatform = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "TEST", modelRaw: "AB Example", bodyCode: "AB", year: 2012, powerHp: 100,
}));
const prefixedPlatformMatch = evaluateMannCandidate(prefixedPlatform, row({
  vehicleVariantKey: "platform-format", make: "TEST", model: "Example II(ABC)", vehicleText: "1.6", hp: "100", vehicleYearFrom: 2010, vehicleYearTo: 2015,
}));
assert.ok(prefixedPlatformMatch.candidate?.matchedFields.includes("код кузова"), "a leading provider platform code matches a longer code from the same MANN chassis family");

const numericAlias = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "TEST", modelRaw: "44", year: 2004, engineSeries: "ВАЗ-4400", engineVolumeCc: 1499, powerHp: 91,
}));
const numericAliasMatch = evaluateMannCandidate(numericAlias, row({
  vehicleVariantKey: "numeric-parenthetical-format", make: "TEST", model: "440(44)", vehicleText: "1.5 16V", engineCode: "4400", hp: "91", vehicleYearFrom: 1996, vehicleYearTo: 2005,
}));
assert.ok(numericAliasMatch.candidate?.matchedFields.includes("базовая модель"), "a numeric model alias in MANN parentheses participates in retrieval/scoring");

assert.equal(normalizeMannYearInput("2002"), "2002");
assert.equal(isValidMannYear("2002", 2026), true);
assert.equal(isValidMannYear("201", 2026), false);
assert.equal(shouldApplyMannRequest(4, 5), false);
assert.equal(shouldApplyMannRequest(5, 5), true);

console.log("MANN vehicle resolver regression tests — passed");
