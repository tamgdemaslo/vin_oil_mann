# Product attribute XML source

This directory is the canonical landing zone for the ten reviewed XML dictionaries.

| File | Root | Item | Status on 2026-09-02 |
| --- | --- | --- | --- |
| `brands.xml` | `BrandValues` | `Brand` | source received (`values.xml`) |
| `engine-sae.xml` | `SAEValues` | `SAE` | source received; byte-identical to `data/values-xml-4.xml` |
| `package-volumes.xml` | `VolumeValues` | `Volume` | source received (`values-3.xml`) |
| `acea.xml` | `ACEAValues` | `ACEA` | source received; byte-identical to `data/values-xml.xml` |
| `engine-api.xml` | `APIValues` | `API` | source received; byte-identical to `data/values-xml-2.xml` |
| `engine-oem.xml` | `OEMOilValues` | `OEMOil` | source received; byte-identical to `data/values-xml-3.xml` |
| `transmission-sae.xml` | `SAEValues` | `SAE` | source received (`values-7.xml`) |
| `atf.xml` | `ATFValues` | `ATF` | source received (`values-8.xml`) |
| `transmission-api.xml` | `APIValues` | `API` | source received (`values-9.xml`) |
| `transmission-oem.xml` | `OEMOilValues` | `OEMOil` | source received (`values-10.xml`) |

Run `npm run generate:product-attribute-dictionaries` after changing any source. The strict generator validates root/item tags and refuses missing sources. `npm run generate:product-attribute-dictionaries:partial` is only for an explicitly incomplete bootstrap and records every missing file in metadata.
