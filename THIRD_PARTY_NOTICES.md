# Third-Party Notices

This project is released under the Apache License, Version 2.0 (see
[`LICENSE`](LICENSE)). Apache-2.0 covers the original source, configuration,
documentation, and application code in this repository.

It does **not** relicense the third-party assets listed below. Those assets
are redistributed under their own licenses, and their license terms and
copyright notices continue to apply to them unchanged.

## Bundled font assets

The web application self-hosts two font files. Each is redistributed
unmodified, together with the full text of its license, and neither is
fetched from a third-party service at runtime.

### IBM Plex Sans (variable, roman)

- **File:** [`web/public/fonts/ibm-plex-sans-var-roman.woff2`](web/public/fonts/ibm-plex-sans-var-roman.woff2)
- **Used for:** all interface and body text.
- **Copyright:** © 2017 IBM Corp., with Reserved Font Name "Plex".
- **License:** SIL Open Font License, Version 1.1.
- **License text:** [`web/public/fonts/LICENSE.txt`](web/public/fonts/LICENSE.txt)
- **Upstream:** <https://github.com/IBM/plex>

### STIX Two Math

- **File:** [`web/public/fonts/stix-two-math.woff2`](web/public/fonts/stix-two-math.woff2)
- **Used for:** MathML rendering of display equations in the Technical
  Documentation. The complete font is bundled because MathML layout depends
  on the OpenType MATH table and on variant and assembly glyphs a subsetter
  would remove.
- **Copyright:** © 2001–2021 The STIX Fonts Project Authors, with Reserved
  Font Name "TM Math". STIX Fonts™ is a trademark of the Institute of
  Electrical and Electronics Engineers, Inc.
- **License:** SIL Open Font License, Version 1.1.
- **License text:** [`web/public/fonts/STIX-LICENSE.txt`](web/public/fonts/STIX-LICENSE.txt)
- **Upstream:** <https://github.com/stipub/stixfonts>

The SIL Open Font License requires that each copy of the font software carry
its copyright notice and license; those files are kept next to the font
binaries they cover and must travel with them in any redistribution.

## Runtime and build dependencies

The Python engine and API depend on `numpy`, `scipy`, `pydantic`, `pyyaml`,
`fastapi`, and `uvicorn`. The web application depends on `react`,
`react-dom`, and `recharts`, with `vite`, `typescript`, and
`@playwright/test` used only for building and testing. These packages are
installed from their respective registries (PyPI, npm) as dependencies and
are **not** vendored into this repository, so their license texts are not
reproduced here. Each package carries its own license in its distribution;
the authoritative version constraints are in
[`pyproject.toml`](pyproject.toml) and
[`web/package.json`](web/package.json).
