# Credits & third-party media

| Asset | Source | Author / site | License | Notes |
|---|---|---|---|---|
| `web/public/media/hero.mp4`, `hero-poster.jpg`, `hero-wide.mp4`, `hero-wide-poster.jpg` | "Diverse millenials using mobiles and social distancing in cafe" https://mixkit.co/free-stock-video/diverse-millenials-using-mobiles-and-social-distancing-in-cafe-15756/ | Mixkit (Envato) | Mixkit Stock Video Free License (https://mixkit.co/license/#videoFree): free for commercial and personal use, no attribution required | Re-encoded without audio: 14 s, 24 fps, H.264. Mobile version is a 3-panel vertical crop (360x926, ~230 KB); desktop version 854x480 (~200 KB). |
| Avatar maker artwork (`web/src/components/MediaStudio.tsx`, `avatarSvg`) | Original SVG drawn for Connectly (no third-party avatar library used) | Connectly | Owned by the project | Diverse skin tones, hair styles and accessories. |
| Connectly logo (`web/public/logo.svg`, icons) | Original artwork made for Connectly | Connectly | Owned by the project | PNG icons generated from the SVG with sharp. |

Do not add media unless its licence allows commercial use without payment. Record every new asset here.


## Music (round 8)
Royalty-free tracks bundled in `web/public/music/` (45-second excerpts re-encoded to AAC, with a fade-out). All allow commercial use. Attribution is shown in the app wherever a track plays ("Title · Kevin MacLeod · CC BY") and here.

| Track | Artist | Licence | Source |
|---|---|---|---|
| Bushwick Tarantella | Kevin MacLeod (incompetech.com) | CC BY 3.0 us (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Bushwick_Tarantella_(MacLeod,_Kevin)_(ISRC_USUAN1300002).oga |
| Funkorama | Kevin MacLeod (incompetech.com) | CC BY 3.0 us (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Funkorama_(MacLeod,_Kevin)_(ISRC_USUAN1100474).oga |
| Healing | Kevin MacLeod (incompetech.com) | CC BY 3.0 us (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Healing_(Kevin_MacLeod)_(ISRC_USUAN1200048).oga |
| Call to Adventure | Kevin MacLeod (incompetech.com) | CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Call_to_Adventure.ogg |
| Clean Soul | Kevin MacLeod (incompetech.com) | CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Clean_Soul.ogg |
| Fluffing a Duck | Kevin MacLeod (incompetech.com) | CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Fluffing_a_Duck.ogg |
| Monkeys Spinning Monkeys | Kevin MacLeod (incompetech.com) | CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Monkeys_Spinning_Monkeys.ogg |
| Kool Kats | Kevin MacLeod (incompetech.com) | CC BY 3.0 us (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Kool_Kats_(MacLeod,_Kevin)_(ISRC_USUAN1100601).oga |
| Stringed Disco | Kevin MacLeod (incompetech.com) | CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Stringed_Disco_(MacLeod,_Kevin)_(ISRC_USUAN1100059).oga |
| Tea Roots | Kevin MacLeod (incompetech.com) | CC BY 3.0 us (https://creativecommons.org/licenses/by/3.0/) | https://commons.wikimedia.org/wiki/File:Tea_Roots_(MacLeod,_Kevin)_(ISRC_USUAN1100472).oga |

Attribution text: "<Title>" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 3.0 License, http://creativecommons.org/licenses/by/3.0/

The music system is pluggable (`server/music/index.js`). A licensed catalog can be added later as another provider; record its licence terms here.

## Stickers (round 8)
The animated stickers in `web/public/stickers/` are original artwork made for Connectly (released by the project under CC0). The wave, clap and thumbs stickers animate the device's own emoji font. No GIF service is used: Tenor and GIPHY both need an account and API key, so only the bundled stickers ship.

## AR effects (round 8)
Face tracking uses MediaPipe Tasks Vision (`@mediapipe/tasks-vision`, Apache-2.0) and Google's Face Landmarker model (`face_landmarker.task`, Apache-2.0), self-hosted in `web/public/mediapipe/`. Effect artwork is drawn in code.

## Interaction sounds (round 7)
All interaction sounds (like, reaction, post published, comment sent, message sent and received, follow, notification, live gift) are original: they are synthesised at runtime from sine and triangle tones with the Web Audio API in `web/src/lib/sounds.ts`. No audio files or third-party samples are used. Owned by the project.
