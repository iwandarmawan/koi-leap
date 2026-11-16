[![ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/iwandarmawan/koi-leap/rank.svg)](https://make.fun/bounty/ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/iwandarmawan/koi-leap/reward.svg)](https://make.fun/bounty/ai-excited-01)

# The Dragon That Escaped Its Book

An original procedurally drawn image for [make.fun](https://make.fun/bounty/ai-excited-01)'s **ai-excited-01** bounty ($250, top 20 share it).

A great golden dragon bursts out of an open pop-up book on a desk at night:
paper shards and loose pages explode outward, its body arcs diagonally across
the frame, wings spread wide, fire jetting from its jaws, embers rising. Below,
a small brass desk lamp, scattered pencils, an ink bottle and a stack of books
give the scale — the dragon is bigger than the room it escaped from.

## How it is made

`main.ts` (Node 22, standard library only — `node:fs`, `node:path`,
`node:zlib`) draws the whole image pixel by pixel with its own small
rasterizer: gradients, glows, polygons, scales, fins, shards and embers, all
from a fixed seed. It then encodes the result as a PNG itself (own CRC32 and
zlib deflate, Sub filter per row). No network, no external files, no
wall clock, no unseeded randomness — two runs write byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png — 1024x1024 RGB PNG, ~260 KB
```

## License

MIT — see [LICENSE](LICENSE).
