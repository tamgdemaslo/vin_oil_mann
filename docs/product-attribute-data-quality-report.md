# Data-quality report: product fluid attributes

- Version: `52a1a8b775c4ff10`
- Generated at: 2026-09-02T17:12:30.469Z
- Complete source set: yes
- Available XML: 10/10
- Missing: none

## Source files

| Field | File | SHA-256 | Root/item | Source | Canonical | Legacy comparison |
| --- | --- | --- | --- | ---: | ---: | --- |
| brand | `data/product-attributes/source/brands.xml` | `ebb8a7316bb47e76767de3f6a8287a2a38337a0dabe6e383b9d89087a605c9d6` | BrandValues/Brand | 690 | 690 | n/a |
| engineSae | `data/product-attributes/source/engine-sae.xml` | `69453b7858fee9b6cea5653dbd81eab4df2d0a880f616766f96f5deb7209386b` | SAEValues/SAE | 42 | 42 | MATCH |
| packageVolume | `data/product-attributes/source/package-volumes.xml` | `8781d9dbcaaa54439e1dcdc42356253bb4cb5a3a17f26c0c02f6d6043dac39fe` | VolumeValues/Volume | 443 | 443 | n/a |
| acea | `data/product-attributes/source/acea.xml` | `b62f119ee1d52a50bb00ea168def3506389b5d984861ea2b08ba9fb9d30b30a4` | ACEAValues/ACEA | 33 | 33 | MATCH |
| engineApi | `data/product-attributes/source/engine-api.xml` | `5823ab11038112a13f60a9fc87cfbec542e6fafe76296273fcf898e61a4b07de` | APIValues/API | 53 | 53 | MATCH |
| engineOem | `data/product-attributes/source/engine-oem.xml` | `f294e3660b45ede71b4a798bf2c7d915d605881faac27e40192f971a369f46b8` | OEMOilValues/OEMOil | 530 | 523 | MATCH |
| transmissionSae | `data/product-attributes/source/transmission-sae.xml` | `61b6007e072072b56dbdd872709a84de4b91a5a8ccfd368a5224a6763458f197` | SAEValues/SAE | 53 | 53 | n/a |
| atf | `data/product-attributes/source/atf.xml` | `97fa518a81784ff1fdded3892da1bdf96efa728ca62da8a37aed27b376f3cc0a` | ATFValues/ATF | 63 | 63 | n/a |
| transmissionApi | `data/product-attributes/source/transmission-api.xml` | `7266cd4dc86f51d502b1b10d672f7407bf9378f74705ab16409b46a539848670` | APIValues/API | 22 | 22 | n/a |
| transmissionOem | `data/product-attributes/source/transmission-oem.xml` | `c5a89ae31bfbce303f59c4c25a74398c3b60ff52215c3a650b7e2536529f9197` | OEMOilValues/OEMOil | 873 | 870 | n/a |

## Summary

- EXACT_DUPLICATE: 6
- CASE_VARIANT: 0
- WHITESPACE_VARIANT: 7
- PUNCTUATION_VARIANT: 3
- UNICODE_CONFUSABLE: 1
- SEMANTIC_ALIAS_CANDIDATE: 4
- CROSS_DICTIONARY_VALUE: 19
- SUSPICIOUS_VALUE: 3
- COLLISION: 0
- NO_ISSUE: 2759

## Reclassifications and anomalies

- **SUSPICIOUS_VALUE** [brand] `OEM`
- **SUSPICIOUS_VALUE** [engineSae] `Не подлежит классификации по SAE`
- **UNICODE_CONFUSABLE** [acea] `А4` → `A4`
- **WHITESPACE_VARIANT** [engineOem] `Ford WSS-M2C153-H` → `Ford WSS-M2C 153-H`
- **WHITESPACE_VARIANT** [engineOem] `Ford WSS-M2C912-A` → `Ford WSS-M2C 912-A`
- **WHITESPACE_VARIANT** [engineOem] `Ford WSS-M2C913-C` → `Ford WSS-M2C 913-C`
- **WHITESPACE_VARIANT** [engineOem] `Ford WSS-M2C925-A` → `Ford WSS-M2C 925-A`
- **PUNCTUATION_VARIANT** [engineOem] `GM dexos1` → `GM Dexos 1`
- **PUNCTUATION_VARIANT** [engineOem] `GM dexos1 Gen 2` → `GM Dexos 1 Gen 2`
- **PUNCTUATION_VARIANT** [engineOem] `GM dexos1 Gen 3` → `GM Dexos 1 Gen 3`
- **SUSPICIOUS_VALUE** [transmissionSae] `Не подлежит классификации по SAE`
- **WHITESPACE_VARIANT** [transmissionOem] `Ford CVT 23` → `Ford CVT23`
- **WHITESPACE_VARIANT** [transmissionOem] `Ford CVT 30` → `Ford CVT30`
- **WHITESPACE_VARIANT** [transmissionOem] `Massey Ferguson M 1135` → `Massey Ferguson M1135`
- **CROSS_DICTIONARY_VALUE** [engineApi] `GF-4` → ilsac — GF is an ILSAC family
- **CROSS_DICTIONARY_VALUE** [engineApi] `GF-5` → ilsac — GF is an ILSAC family
- **EXACT_DUPLICATE** [transmissionApi] `GL-3` — GL/MT is a transmission API family
- **CROSS_DICTIONARY_VALUE** [engineApi] `GL-3` → transmissionApi — GL/MT is a transmission API family
- **EXACT_DUPLICATE** [transmissionApi] `GL-4` — GL/MT is a transmission API family
- **CROSS_DICTIONARY_VALUE** [engineApi] `GL-4` → transmissionApi — GL/MT is a transmission API family
- **EXACT_DUPLICATE** [transmissionApi] `GL-5` — GL/MT is a transmission API family
- **CROSS_DICTIONARY_VALUE** [engineApi] `GL-5` → transmissionApi — GL/MT is a transmission API family
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-1` → `GF-1` → ilsac — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-2` → `GF-2` → ilsac — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-3` → `GF-3` → ilsac — ILSAC extracted from engine OEM source
- **EXACT_DUPLICATE** [ilsac] `GF-4` — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-4` → `GF-4` → ilsac — ILSAC extracted from engine OEM source
- **EXACT_DUPLICATE** [ilsac] `GF-5` — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-5` → `GF-5` → ilsac — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-6` → `GF-6` → ilsac — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-6A` → `GF-6A` → ilsac — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-6B` → `GF-6B` → ilsac — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-7` → `GF-7` → ilsac — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-7A` → `GF-7A` → ilsac — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ILSAC GF-7B` → `GF-7B` → ilsac — ILSAC extracted from engine OEM source
- **CROSS_DICTIONARY_VALUE** [engineOem] `ACEA E4/E7` → `E4/E7` → acea — ACEA removed from OEM dropdown
- **CROSS_DICTIONARY_VALUE** [engineOem] `API CI-4/CH-4` → `CI-4/CH-4` → engineApi — API removed from OEM dropdown
- **EXACT_DUPLICATE** [engineApi] `SN Plus` — API removed from OEM dropdown
- **CROSS_DICTIONARY_VALUE** [engineOem] `SN Plus` → engineApi — API removed from OEM dropdown
- **SEMANTIC_ALIAS_CANDIDATE** [engineOem] `BMW LL-04` → `BMW Longlife-04` — verified common abbreviation
- **SEMANTIC_ALIAS_CANDIDATE** [engineOem] `GM dexos2` → `GM Dexos 2` — verified spelling variant
- **SEMANTIC_ALIAS_CANDIDATE** [engineOem] `VW 505 00` → `VW 505.00` — verified punctuation variant
- **SEMANTIC_ALIAS_CANDIDATE** [engineOem] `VW 505 01` → `VW 505.01` — verified punctuation variant

## Collisions

No lookup-key collisions.
