[![ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/iwandarmawan/koi-leap/rank.svg)](https://make.fun/bounty/ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/iwandarmawan/koi-leap/reward.svg)](https://make.fun/bounty/ai-excited-01)

# Koi Leap

An original procedurally drawn image for [make.fun](https://make.fun/bounty/ai-excited-01)'s **ai-excited-01** bounty ($250, top 20 share it).

A colossal golden-crimson koi leaps out of a dark indigo sea toward a huge
glowing full moon, its body arcing diagonally across a star-filled night sky.
Water spray bursts off its leap and turns into stars; below, a tiny lantern
boat drifts on the waves, and the moon's reflection shimmers on the water.

## How it is made

`main.ts` (Node 22, standard library only — `node:fs`, `node:path`,
`node:zlib`) draws the whole image pixel by pixel with its own small
rasterizer: gradients, glows, polygons, scales, fins, spray and stars, all
from a fixed seed. It then encodes the result as a PNG itself (own CRC32 and
zlib deflate, Sub filter per row). No network, no external files, no
wall clock, no unseeded randomness — two runs write byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png — 1024x1024 RGB PNG, ~344 KB
```

## License

MIT — see [LICENSE](LICENSE).
