# scripts/oracles/starter-pack-oracle.py (example: an independent oracle in another language)
# Computes the starter-pack vector rows from the written spec: FNV-1a over UTF-16 code units, the
# murmur3 finaliser, PractRand sfc32 with 12 warm-up draws, partial Fisher-Yates from the front, and
# canonical JSON v1. It shares no code with src/ and carries its own copy of the salt and catalogs.
#   python3 scripts/oracles/starter-pack-oracle.py          verify (CI): exit 1 when a row disagrees
#   python3 scripts/oracles/starter-pack-oracle.py --fill   by hand: fill rows that hold only key,
#                                                           version and note; never change a filled row
import json
import sys

VECTORS = 'src/features/starter-pack/starter-pack.vectors.json'
SALT = 0x6C1F93A5
CATALOGS = {1: ['task-%02d' % i for i in range(1, 11)], 2: ['task-%02d' % i for i in range(1, 13)]}
PICKS = {1: 3, 2: 5}
M, GAMMA = 0xFFFFFFFF, 0x9E3779B9


def u32(x):
    return x & M


def to_int32(x):
    x &= M
    return x - (1 << 32) if x >= (1 << 31) else x


def mix32(v):
    z = u32(v)
    z = u32((z ^ (z >> 16)) * 0x85EBCA6B)
    z = u32((z ^ (z >> 13)) * 0xC2B2AE35)
    return z ^ (z >> 16)


def next_u32(s):
    a, b, c, d = s
    t = u32(a + b + d)
    return t, (b ^ (b >> 9), u32(c + (c << 3)), u32(u32((c << 21) | (c >> 11)) + t), u32(d + 1))


def seed_rng(seed):
    s = to_int32(seed)
    state = tuple(mix32(s + k * GAMMA) for k in (1, 2, 3, 4))
    for _ in range(12):
        _, state = next_u32(state)
    return state


def next_int(s, n):
    limit = (1 << 32) - ((1 << 32) % n)
    v, s = next_u32(s)
    while v >= limit:
        v, s = next_u32(s)
    return v % n, s


def fnv1a32(text):
    raw, h = text.encode('utf-16-le'), 0x811C9DC5
    for i in range(0, len(raw), 2):
        h = u32((h ^ (raw[i] | raw[i + 1] << 8)) * 0x01000193)
    return h


def draw_sample(items, count, state):
    out = list(items)
    for i in range(count):
        j, state = next_int(state, len(out) - i)
        out[i], out[i + j] = out[i + j], out[i]
    return out[:count]


def oracle_row(key, version):
    if version not in CATALOGS:
        raise SystemExit('the oracle knows no version %d' % version)
    ids = draw_sample(CATALOGS[version], PICKS[version], seed_rng(fnv1a32(key) ^ SALT))
    # Canonical JSON written by hand: keys in code-unit order (code < taskIds < version).
    text = '{"code":%s,"taskIds":[%s],"version":%d}' % (json.dumps(key), ','.join(json.dumps(i) for i in ids), version)
    return {'fingerprint': '%08x' % fnv1a32(text), 'summary': ' '.join(ids)}


def main():
    fill = sys.argv[1:] == ['--fill']
    with open(VECTORS, encoding='utf-8') as handle:
        data = json.load(handle)
    rows, problems = [], []
    for row in data['rows']:
        want = oracle_row(row['key'], row['version'])
        if 'fingerprint' in row or 'summary' in row:
            if (row.get('fingerprint'), row.get('summary')) != (want['fingerprint'], want['summary']):
                problems.append('%s v%d: the oracle gives %s' % (row['key'], row['version'], want['fingerprint']))
            rows.append(row)
        elif fill:
            rows.append({'key': row['key'], 'version': row['version'], **want, 'note': row['note']})
        else:
            problems.append('%s v%d: not filled yet (run with --fill by hand)' % (row['key'], row['version']))
            rows.append(row)
    for problem in problems:
        print('row refused: ' + problem, file=sys.stderr)
    if problems:
        sys.exit(1)
    if fill:
        with open(VECTORS, 'w', encoding='utf-8') as handle:
            handle.write(json.dumps(dict(data, rows=rows), indent=2, ensure_ascii=False) + '\n')
    print('%s: %d rows agree with the oracle' % (VECTORS, len(rows)))


if __name__ == '__main__':
    main()
