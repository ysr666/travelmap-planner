# Product Fidelity Fixture Media

These files are deterministic test and design-qualification assets. They are not Provider responses and must not be presented as a photo for a different production travel object. Runtime Provider media keeps its own attribution, observation time, and expiry.

## Photographs

| Local file | Subject | Author | Source | License | Changes |
| --- | --- | --- | --- | --- | --- |
| `edinburgh-castle-hero.webp`, `edinburgh-castle-thumb.webp` | Edinburgh Castle | Ingo Mehling | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Edinburgh_Castle_-_Front_side.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Centre crop, resize, WebP compression |
| `british-museum-thumb.webp` | British Museum Great Court | Andres Rueda | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:British_Museum_Great_Court.jpg) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Centre crop, resize, WebP compression |
| `tower-bridge-thumb.webp` | Tower Bridge | CrisNYCa | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tower_Bridge_London_1.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Centre crop, resize, WebP compression |
| `dishoom-thumb.webp` | Food photographed at Dishoom London | Dale Cruse | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Dishoom_London_Fleischgericht.jpg) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Centre crop, resize, WebP compression |
| `lner-azuma-thumb.webp` | LNER Azuma train | Walter Baxter | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:An_LNER_Azuma_train_on_the_East_Coast_Railway_Line,_geograph_6275180_by_Walter_Baxter.jpg) | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | Centre crop, resize, WebP compression |
| `hotel-room-thumb.webp` | Washington Mayfair Hotel bedroom | Mastcraft | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Washington_Mayfair_Hotel,_Bedroom.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Centre crop, resize, WebP compression |

The CC BY-SA derivatives in this directory are distributed under the corresponding share-alike license above. Attribution is also represented in `assets.json` so the product-fidelity UI can exercise the attribution surface.

## Brand Marks

| Local file | Brand | Source | Copyright status | Product use |
| --- | --- | --- | --- | --- |
| `brand-air-china.svg` | Air China wordmark | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Air_China_wordmark.svg) | Public-domain simple wordmark; trademark may apply | Nominative identification of a structured `CA` carrier code |
| `brand-allianz.svg` | Allianz | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Allianz.svg) | Public-domain simple logo; trademark may apply | Nominative identification of a structured Allianz insurer record |
| `brand-lner.svg` | London North Eastern Railway | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:LNER_Logo.svg) | Public-domain simple logo; trademark may apply | Nominative identification of a structured LNER operator record |
| `brand-national-rail.svg` | National Rail | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:National_Rail_logo.svg) | UK government public-domain mark; trademark may apply | Nominative identification of UK rail transport |

Brand files are bundled, reviewed SVGs. Runtime remote-photo validation still rejects SVG and executable media. AI output and free text cannot select these files; only the versioned brand registry can resolve them from structured codes or controlled aliases.

## Integrity

The authoritative SHA-256, dimensions, byte sizes, attribution, and render paths are in `assets.json`. CI verifies the files against that manifest before product-fidelity screenshots run.
