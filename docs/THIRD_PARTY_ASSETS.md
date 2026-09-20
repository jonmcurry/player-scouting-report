# Third-party UI assets

## Lucide icon subset

`coach/assets/icons.svg` contains a small, hand-selected subset of icons from
[Lucide](https://lucide.dev/) for BarrelTrace's shared application chrome and status components.
No runtime icon package is included.

Lucide is distributed under the ISC License and incorporates listed Feather icons under MIT:
<https://github.com/lucide-icons/lucide/blob/main/LICENSE>.

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without
fee is hereby granted, provided that the above copyright notice and this permission notice appear
in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
OF THIS SOFTWARE.

The MIT portions retain the notice published in Lucide's complete license linked above.

## Fonts

The coach app currently requests Inter, Oswald, and JetBrains Mono from Google Fonts at runtime.
Phase 1A verified that the repository has no existing font-binary dependency or subsetting workflow.
The fonts were therefore not copied into the repository in this pass. System-font fallbacks remain
functional offline; vendoring should be done only with pinned binaries, the corresponding OFL files,
and an explicit update process.
